export type TrainingPayload = {
  teamId?: string;
  title?: string;
  objective?: string;
  sessionDate?: string;
  durationMinutes?: number;
  status?: "planned" | "completed" | "cancelled";
  notes?: string;
  drills?: {
    name?: string;
    focus?: string;
    durationMinutes?: number;
    description?: string;
  }[];
};

export function normalizeTraining(payload: TrainingPayload) {
  const title = payload.title?.trim() ?? "";
  const objective = payload.objective?.trim() ?? "";
  const durationMinutes = Number(payload.durationMinutes);
  const drills = (payload.drills ?? []).map((drill, index) => ({
    position: index + 1,
    name: drill.name?.trim() ?? "",
    focus: drill.focus?.trim().slice(0, 120) || null,
    durationMinutes: Number(drill.durationMinutes),
    description: drill.description?.trim().slice(0, 800) || null,
  }));
  if (!payload.teamId) return { error: "Selecione uma turma." } as const;
  if (title.length < 3 || title.length > 100) return { error: "Informe o título do treino." } as const;
  if (objective.length < 3 || objective.length > 300) return { error: "Informe o objetivo principal." } as const;
  if (!payload.sessionDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.sessionDate)) return { error: "Informe uma data válida." } as const;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) return { error: "A duração deve ficar entre 15 e 240 minutos." } as const;
  if (!drills.length || drills.some((drill) => drill.name.length < 2 || !Number.isInteger(drill.durationMinutes) || drill.durationMinutes < 1)) return { error: "Inclua ao menos um exercício válido." } as const;
  if (drills.reduce((sum, drill) => sum + drill.durationMinutes, 0) > durationMinutes) return { error: "A soma dos exercícios ultrapassa a duração do treino." } as const;
  return { value: { teamId: payload.teamId, title, objective, sessionDate: payload.sessionDate, durationMinutes, status: payload.status ?? "planned", notes: payload.notes?.trim().slice(0, 1000) || null, drills } } as const;
}
