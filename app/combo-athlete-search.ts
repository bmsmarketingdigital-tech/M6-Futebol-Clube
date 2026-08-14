// Lógica pura de busca do combobox de aluno (modal "Aplicar combo").
// Extraída para um módulo sem JSX para poder ser importada e executada
// DE VERDADE em teste, em vez de reimplementada por regex/duplicação.

export type SearchableAthlete = { id: string; name: string; active?: boolean };

// Minúsculas, sem acentos, espaços colapsados.
export function normalizeForSearch(value: string): string {
  const diacritics = /[̀-ͯ]/g;
  return value
    .normalize("NFD")
    .replace(diacritics, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// Mesma regra de elegibilidade de sempre: apenas alunos ativos.
export function getEligibleAthletes<T extends SearchableAthlete>(athletes: T[]): T[] {
  return athletes.filter((athlete) => athlete.active !== false);
}

// Resultado exibido no dropdown: só os elegíveis cujo nome contém a busca.
// Query vazia retorna todos os elegíveis; sem correspondência retorna [].
export function filterAthletesForQuery<T extends SearchableAthlete>(athletes: T[], query: string): T[] {
  const eligible = getEligibleAthletes(athletes);
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return eligible;
  return eligible.filter((athlete) => normalizeForSearch(athlete.name).includes(normalizedQuery));
}
