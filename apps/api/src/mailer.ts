import type { Locale } from "@ai/shared";
import type { Env } from "./types";

const COPY: Record<Locale, { subject: string; body: (url: string) => string }> = {
  "pt-BR": {
    subject: "Seu link de acesso ao Affiliate Intelligence AI",
    body: (url) =>
      `Use o link abaixo para entrar. Ele vale por 15 minutos e só funciona uma vez.\n\n${url}\n\nSe você não pediu este acesso, ignore este e-mail.`,
  },
  "en-US": {
    subject: "Your Affiliate Intelligence AI sign-in link",
    body: (url) =>
      `Use the link below to sign in. It is valid for 15 minutes and works only once.\n\n${url}\n\nIf you did not request this, you can ignore this email.`,
  },
  es: {
    subject: "Tu enlace de acceso a Affiliate Intelligence AI",
    body: (url) =>
      `Usa el enlace de abajo para entrar. Es válido por 15 minutos y funciona una sola vez.\n\n${url}\n\nSi no lo solicitaste, ignora este correo.`,
  },
};

export type SendResult = { delivered: boolean; provider: "resend" | "log" };

/**
 * Envia o link mágico. Com RESEND_API_KEY usa a API do Resend; sem a chave,
 * apenas registra no log (útil em desenvolvimento). Em produção sem chave,
 * o login não entrega e-mail: configure o segredo antes de abrir o cadastro.
 */
export async function sendMagicLink(
  env: Env,
  to: string,
  url: string,
  locale: Locale,
): Promise<SendResult> {
  const copy = COPY[locale];
  if (!env.RESEND_API_KEY) {
    console.log(`[mailer] RESEND_API_KEY ausente; link para ${to} não enviado por e-mail.`);
    if (env.ENVIRONMENT === "development") console.log(`[mailer] DEV link: ${url}`);
    return { delivered: false, provider: "log" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to,
      subject: copy.subject,
      text: copy.body(url),
    }),
  });
  if (!res.ok) {
    console.error(`[mailer] Resend respondeu ${res.status}`);
    return { delivered: false, provider: "resend" };
  }
  return { delivered: true, provider: "resend" };
}
