"use client";

import { FormEvent, useEffect, useState } from "react";

export type AthleteRecord = {
  id: string;
  name: string;
  initials: string;
  category: string;
  age: number;
  birthDate?: string | null;
  guardianName?: string;
  guardianPhone?: string | null;
  guardianEmail?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  allergies?: string | null;
  medications?: string | null;
  medicalNotes?: string | null;
  imageAuthorized?: boolean;
  attendance: number;
  status: "Em dia" | "Pendente";
  tone: string;
  createdAt?: string;
};

type AthleteDocument = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  kind: "identity" | "medical" | "authorization" | "other";
  createdAt: string;
  downloadUrl: string;
};

type Tab = "cadastro" | "saude" | "documentos";

export function AthleteProfileModal({
  athlete,
  onClose,
  onSaved,
  onArchived,
  notify,
}: {
  athlete: AthleteRecord;
  onClose: () => void;
  onSaved: (athlete: AthleteRecord) => void;
  onArchived: (athleteId: string) => void;
  notify: (message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("cadastro");
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [documents, setDocuments] = useState<AthleteDocument[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (tab === "documentos") void loadDocuments();
  }, [tab, athlete.id]);

  async function loadDocuments() {
    setLoadingDocuments(true);
    try {
      const response = await fetch(`/api/athletes/${athlete.id}/documents`);
      const payload = (await response.json()) as {
        documents?: AthleteDocument[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar documentos.");
      setDocuments(payload.documents ?? []);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao carregar documentos.");
    } finally {
      setLoadingDocuments(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);

    try {
      const response = await fetch(`/api/athletes/${athlete.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") || ""),
          category: String(form.get("category") || ""),
          birthDate: String(form.get("birthDate") || ""),
          guardianName: String(form.get("guardianName") || ""),
          guardianPhone: String(form.get("guardianPhone") || ""),
          guardianEmail: String(form.get("guardianEmail") || ""),
          emergencyName: String(form.get("emergencyName") || ""),
          emergencyPhone: String(form.get("emergencyPhone") || ""),
          allergies: String(form.get("allergies") || ""),
          medications: String(form.get("medications") || ""),
          medicalNotes: String(form.get("medicalNotes") || ""),
          imageAuthorized: form.get("imageAuthorized") === "on",
        }),
      });
      const payload = (await response.json()) as {
        athlete?: AthleteRecord;
        error?: string;
      };
      if (!response.ok || !payload.athlete) {
        throw new Error(payload.error || "Não foi possível salvar as alterações.");
      }
      onSaved(payload.athlete);
      notify("Prontuário atualizado e salvo.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar as alterações.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function archiveAthlete() {
    if (
      !window.confirm(
        `Arquivar ${athlete.name}? O histórico será preservado e o atleta sairá das listas ativas.`,
      )
    ) {
      return;
    }

    setArchiving(true);
    try {
      const response = await fetch(`/api/athletes/${athlete.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível arquivar o atleta.");
      }
      onArchived(athlete.id);
      notify(`${athlete.name} foi arquivado. O histórico foi preservado.`);
      onClose();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível arquivar o atleta.",
      );
    } finally {
      setArchiving(false);
    }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      notify("Selecione um documento PDF, JPG ou PNG.");
      return;
    }

    setUploading(true);
    try {
      const response = await fetch(`/api/athletes/${athlete.id}/documents`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as {
        document?: AthleteDocument;
        error?: string;
      };
      if (!response.ok || !payload.document) {
        throw new Error(payload.error || "Não foi possível enviar o documento.");
      }
      setDocuments((current) => [payload.document!, ...current]);
      event.currentTarget.reset();
      notify("Documento armazenado com acesso privado.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o documento.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function removeDocument(document: AthleteDocument) {
    if (!window.confirm(`Excluir o documento “${document.fileName}”?`)) return;

    try {
      const response = await fetch(document.downloadUrl, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível excluir o documento.");
      }
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      notify("Documento excluído.");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Não foi possível excluir o documento.",
      );
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="athlete-profile-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="profile-header">
          <div className={`profile-avatar ${athlete.tone}`}>{athlete.initials}</div>
          <div>
            <span className="eyebrow">PRONTUÁRIO DO ATLETA</span>
            <h2 id="athlete-profile-title">{athlete.name}</h2>
            <p>{athlete.category} · {athlete.age} anos · {athlete.attendance}% de frequência</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Fechar">×</button>
        </header>

        <nav className="profile-tabs" aria-label="Seções do prontuário">
          <button className={tab === "cadastro" ? "active" : ""} onClick={() => setTab("cadastro")}>Cadastro</button>
          <button className={tab === "saude" ? "active" : ""} onClick={() => setTab("saude")}>Saúde e autorizações</button>
          <button className={tab === "documentos" ? "active" : ""} onClick={() => setTab("documentos")}>Documentos <span>{documents.length}</span></button>
        </nav>

        {tab !== "documentos" ? (
          <form className="profile-form" onSubmit={saveProfile}>
            {tab === "cadastro" ? (
              <>
                <div className="profile-section-title"><strong>Dados do atleta</strong><small>Informações utilizadas em turmas, chamadas e relatórios.</small></div>
                <label className="wide">Nome completo<input name="name" defaultValue={athlete.name} required /></label>
                <label>Data de nascimento<input name="birthDate" type="date" defaultValue={athlete.birthDate ?? ""} /></label>
                <label>Categoria<select name="category" defaultValue={athlete.category}><option>Sub-7</option><option>Sub-9</option><option>Sub-11</option><option>Sub-13</option><option>Sub-15</option><option>Sub-17</option></select></label>
                <div className="profile-section-title wide"><strong>Responsável principal</strong><small>Contato para cobranças, comunicados e emergências.</small></div>
                <label className="wide">Nome do responsável<input name="guardianName" defaultValue={athlete.guardianName ?? ""} required /></label>
                <label>Telefone<input name="guardianPhone" type="tel" defaultValue={athlete.guardianPhone ?? ""} placeholder="(11) 99999-9999" /></label>
                <label>E-mail<input name="guardianEmail" type="email" defaultValue={athlete.guardianEmail ?? ""} placeholder="responsavel@email.com" /></label>
                <label>Contato de emergência<input name="emergencyName" defaultValue={athlete.emergencyName ?? ""} /></label>
                <label>Telefone de emergência<input name="emergencyPhone" type="tel" defaultValue={athlete.emergencyPhone ?? ""} /></label>
              </>
            ) : (
              <>
                <div className="profile-section-title wide"><strong>Informações médicas</strong><small>Visíveis somente para a equipe autorizada.</small></div>
                <label className="wide">Alergias<textarea name="allergies" defaultValue={athlete.allergies ?? ""} placeholder="Informe alergias ou escreva “Nenhuma”" /></label>
                <label className="wide">Medicamentos em uso<textarea name="medications" defaultValue={athlete.medications ?? ""} placeholder="Nome, dose e horários relevantes" /></label>
                <label className="wide">Observações médicas<textarea name="medicalNotes" defaultValue={athlete.medicalNotes ?? ""} placeholder="Restrições, cuidados e orientações" /></label>
                <label className="consent-card wide">
                  <input name="imageAuthorized" type="checkbox" defaultChecked={athlete.imageAuthorized} />
                  <span><strong>Autorização de uso de imagem registrada</strong><small>Confirma que a escolinha possui autorização assinada pelo responsável.</small></span>
                </label>
                <input type="hidden" name="name" value={athlete.name} />
                <input type="hidden" name="birthDate" value={athlete.birthDate ?? ""} />
                <input type="hidden" name="category" value={athlete.category} />
                <input type="hidden" name="guardianName" value={athlete.guardianName ?? ""} />
                <input type="hidden" name="guardianPhone" value={athlete.guardianPhone ?? ""} />
                <input type="hidden" name="guardianEmail" value={athlete.guardianEmail ?? ""} />
                <input type="hidden" name="emergencyName" value={athlete.emergencyName ?? ""} />
                <input type="hidden" name="emergencyPhone" value={athlete.emergencyPhone ?? ""} />
              </>
            )}
            <footer className="profile-actions wide">
              <button type="button" className="archive-button" onClick={archiveAthlete} disabled={archiving}>
                {archiving ? "Arquivando..." : "Arquivar atleta"}
              </button>
              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? "Salvando..." : "Salvar alterações"}
              </button>
            </footer>
          </form>
        ) : (
          <div className="documents-panel">
            <form className="upload-card" onSubmit={uploadDocument}>
              <div><strong>Adicionar documento</strong><small>PDF, JPG ou PNG · máximo de 5 MB</small></div>
              <select name="kind" aria-label="Tipo do documento" defaultValue="identity">
                <option value="identity">Identificação</option>
                <option value="medical">Documento médico</option>
                <option value="authorization">Autorização</option>
                <option value="other">Outro</option>
              </select>
              <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required />
              <button className="primary-button" type="submit" disabled={uploading}>{uploading ? "Enviando..." : "Enviar documento"}</button>
            </form>

            <div className="document-list">
              {loadingDocuments && <div className="document-empty">Carregando documentos...</div>}
              {!loadingDocuments && documents.length === 0 && <div className="document-empty"><span>▤</span><strong>Nenhum documento armazenado</strong><small>Adicione ficha de matrícula, atestado ou autorização.</small></div>}
              {documents.map((document) => (
                <article key={document.id} className="document-row">
                  <span className="document-icon">{document.contentType === "application/pdf" ? "PDF" : "IMG"}</span>
                  <div><strong>{document.fileName}</strong><small>{documentKindLabel(document.kind)} · {formatBytes(document.sizeBytes)}</small></div>
                  <a href={document.downloadUrl}>Baixar</a>
                  <button onClick={() => void removeDocument(document)} aria-label={`Excluir ${document.fileName}`}>×</button>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function documentKindLabel(kind: AthleteDocument["kind"]) {
  return {
    identity: "Identificação",
    medical: "Documento médico",
    authorization: "Autorização",
    other: "Outro",
  }[kind];
}
