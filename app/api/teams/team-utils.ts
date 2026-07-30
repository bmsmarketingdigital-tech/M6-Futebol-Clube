import { teams } from "../../../db/schema";

export type TeamPayload = {
  name?: string;
  category?: string;
  coachName?: string;
  scheduleDays?: string[];
  startTime?: string;
  endTime?: string;
  place?: string;
  capacity?: number;
  athleteIds?: string[];
};

const weekdays = new Set([
  "Seg",
  "Ter",
  "Qua",
  "Qui",
  "Sex",
  "Sáb",
  "Dom",
]);

export function normalizeTeamPayload(payload: TeamPayload) {
  const name = payload.name?.trim() ?? "";
  const category = payload.category?.trim() ?? "";
  const coachName = payload.coachName?.trim() ?? "";
  const scheduleDays = Array.from(
    new Set(
      (payload.scheduleDays ?? []).filter((day) => weekdays.has(day)),
    ),
  );
  const startTime = payload.startTime?.trim() ?? "";
  const endTime = payload.endTime?.trim() ?? "";
  const place = payload.place?.trim() ?? "";
  const capacity = Number(payload.capacity);
  const athleteIds = Array.from(
    new Set(
      (payload.athleteIds ?? [])
        .filter((id) => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ).slice(0, 100);

  if (name.length < 2 || name.length > 80) {
    return { error: "Informe um nome válido para a turma." } as const;
  }
  if (category.length < 2 || category.length > 32) {
    return { error: "Selecione uma categoria válida." } as const;
  }
  if (coachName.length < 3 || coachName.length > 100) {
    return { error: "Informe o nome do professor." } as const;
  }
  if (scheduleDays.length === 0) {
    return { error: "Selecione pelo menos um dia de treino." } as const;
  }
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    return { error: "Informe horários válidos." } as const;
  }
  if (endTime <= startTime) {
    return { error: "O horário final deve ser posterior ao inicial." } as const;
  }
  if (place.length < 2 || place.length > 80) {
    return { error: "Informe o local do treino." } as const;
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
    return { error: "A capacidade deve estar entre 1 e 100 atletas." } as const;
  }
  if (athleteIds.length > capacity) {
    return { error: "A quantidade de atletas supera a capacidade da turma." } as const;
  }

  return {
    value: {
      name,
      category,
      coachName,
      scheduleDays,
      startTime,
      endTime,
      place,
      capacity,
      athleteIds,
    },
  } as const;
}

export function teamToDto(
  team: typeof teams.$inferSelect,
  athleteIds: string[],
) {
  let scheduleDays: string[] = [];
  try {
    const parsed = JSON.parse(team.scheduleDays) as unknown;
    if (Array.isArray(parsed)) {
      scheduleDays = parsed.filter((day): day is string => typeof day === "string");
    }
  } catch {
    scheduleDays = [];
  }

  const colorByCategory: Record<string, string> = {
    "Sub-7": "purple",
    "Sub-9": "green",
    "Sub-11": "blue",
    "Sub-13": "orange",
    "Sub-15": "purple",
    "Sub-17": "navy",
  };

  return {
    id: team.id,
    name: team.name,
    category: team.category,
    coachName: team.coachName ?? "",
    scheduleDays,
    startTime: team.startTime,
    endTime: team.endTime,
    place: team.place,
    capacity: team.capacity,
    athleteIds,
    players: athleteIds.length,
    color: colorByCategory[team.category] ?? "green",
  };
}
