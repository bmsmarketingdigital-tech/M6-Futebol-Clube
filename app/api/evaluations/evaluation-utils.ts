export type EvaluationPayload = {
  athleteId?: string;
  evaluationDate?: string;
  technicalScore?: number;
  physicalScore?: number;
  tacticalScore?: number;
  behavioralScore?: number;
  strengths?: string;
  improvements?: string;
  nextGoals?: string;
};

export function normalizeEvaluation(payload: EvaluationPayload, options: { requireAthlete?: boolean } = {}) {
  const scores = [
    Number(payload.technicalScore),
    Number(payload.physicalScore),
    Number(payload.tacticalScore),
    Number(payload.behavioralScore),
  ];
  if (options.requireAthlete !== false && !payload.athleteId) return { error: "Selecione um atleta." } as const;
  if (!payload.evaluationDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.evaluationDate)) {
    return { error: "Informe uma data válida." } as const;
  }
  if (scores.some((score) => !Number.isInteger(score) || score < 1 || score > 5)) {
    return { error: "Todas as notas devem estar entre 1 e 5." } as const;
  }
  return {
    value: {
      ...(payload.athleteId ? { athleteId: payload.athleteId } : {}),
      evaluationDate: payload.evaluationDate,
      technicalScore: scores[0],
      physicalScore: scores[1],
      tacticalScore: scores[2],
      behavioralScore: scores[3],
      strengths: payload.strengths?.trim().slice(0, 1000) || null,
      improvements: payload.improvements?.trim().slice(0, 1000) || null,
      nextGoals: payload.nextGoals?.trim().slice(0, 1000) || null,
    },
  } as const;
}

export function evaluationDto(row: {
  id: string;
  athleteId: string;
  athleteName: string;
  category: string;
  evaluationDate: string;
  technicalScore: number;
  physicalScore: number;
  tacticalScore: number;
  behavioralScore: number;
  strengths: string | null;
  improvements: string | null;
  nextGoals: string | null;
  evaluatedBy: string;
}) {
  return {
    ...row,
    overallScore:
      (row.technicalScore +
        row.physicalScore +
        row.tacticalScore +
        row.behavioralScore) /
      4,
  };
}
