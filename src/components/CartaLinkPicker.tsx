import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { cartaLinkCandidates } from "@/lib/cartaLeadSync";
import { useToast } from "@/components/Toast";

type Props = {
  entryId: string;
  personKey: string;
};

/** Selector staff para vincular a mano una carta dudosa/homónima a un lead. */
export function CartaLinkPicker({ entryId, personKey }: Props) {
  const { data, linkCartaToLead } = useStore();
  const { toast } = useToast();
  const [leadId, setLeadId] = useState("");
  const [saving, setSaving] = useState(false);
  const candidates = useMemo(
    () => cartaLinkCandidates(personKey, data.leads, data.reportEntries),
    [personKey, data.leads, data.reportEntries]
  );
  if (candidates.length === 0) return <em> · sin leads con ese nombre</em>;

  const agentName = (id: string | null) =>
    (id && data.profiles.find((p) => p.id === id)?.fullName) || "sin agente";

  const onLink = async () => {
    if (!leadId) return;
    setSaving(true);
    const res = await linkCartaToLead(entryId, leadId);
    setSaving(false);
    const lead = data.leads.find((l) => l.id === leadId);
    toast(res.ok ? `Carta vinculada a #${lead?.leadNumber}` : res.error || "No se pudo vincular");
  };

  return (
    <span className="carta-link-picker">
      {" · "}
      <select value={leadId} onChange={(e) => setLeadId(e.target.value)} disabled={saving}>
        <option value="">Vincular a…</option>
        {candidates.map(({ lead, hasCarta }) => (
          <option key={lead.id} value={lead.id} disabled={hasCarta}>
            #{lead.leadNumber} {lead.firstName} {lead.lastName} · {lead.status}
            {lead.phone ? ` · tel …${lead.phone.replace(/\D/g, "").slice(-4)}` : ""} ·{" "}
            {agentName(lead.assignedAgentId)}
            {hasCarta ? " · ya tiene carta" : ""}
          </option>
        ))}
      </select>{" "}
      <button type="button" className="btn btn-sm" onClick={onLink} disabled={!leadId || saving}>
        {saving ? "Vinculando…" : "Vincular"}
      </button>
    </span>
  );
}
