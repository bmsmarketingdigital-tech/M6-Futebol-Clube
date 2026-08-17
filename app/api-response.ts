export async function readApiResponse<T>(response: Response): Promise<T & { error?: string }> {
  const body = await response.text();
  if (!body.trim()) {
    throw new Error(
      response.ok
        ? "O servidor retornou uma resposta vazia. Tente novamente."
        : `O serviço está temporariamente indisponível (${response.status}).`,
    );
  }
  try {
    return JSON.parse(body) as T & { error?: string };
  } catch {
    throw new Error(`O servidor retornou uma resposta inválida (${response.status}).`);
  }
}
