import { ApiError } from "../api";
import { MESSAGES, type MessageKey } from "../i18n/messages";

/** Rótulo traduzido de um campo; se não houver, mostra o nome técnico. */
export function fieldLabel(t: (k: MessageKey) => string, field: string): string {
  const key = `f.${field}`;
  return key in MESSAGES["pt-BR"] ? t(key as MessageKey) : field;
}

export function errorMessage(
  e: unknown,
  t: (k: MessageKey, v?: Record<string, string | number>) => string,
): string {
  if (e instanceof ApiError) {
    if (e.code === "official_source_required") {
      const fields = ((e.data.fields as string[] | undefined) ?? []).map((f) => fieldLabel(t, f)).join(", ");
      return t("err.official_source_required", { fields: fields || "—" });
    }
    if (e.code.startsWith("duplicate_")) return t("err.duplicate");
    if (e.code === "unofficial_source_cannot_confirm") return t("err.unofficial");
    if (`err.${e.code}` in MESSAGES["pt-BR"]) return t(`err.${e.code}` as MessageKey);
    if (e.status === 403) return t("error.forbidden");
  }
  return t("err.generic");
}
