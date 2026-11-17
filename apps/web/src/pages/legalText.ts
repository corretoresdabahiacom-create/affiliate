import type { Locale } from "@ai/shared";

/**
 * Texto-base de Privacidade e Termos, escrito a partir do que o sistema realmente faz.
 * É um modelo: o operador deve revisá-lo com assessoria jurídica antes da operação comercial (docs/SECURITY.md).
 * {operator} e {contact} vêm do administrador (/api/legal).
 */
export interface LegalSection { h: string; p: string[] }
export interface LegalDoc { title: string; updated: string; sections: LegalSection[] }
export const LEGAL_UPDATED = "2026-11-17";

const privacyPt: LegalDoc = {
  title: "Política de Privacidade", updated: "Atualizada em 17/11/2026",
  sections: [
    { h: "1. Quem é o responsável", p: ["O controlador dos seus dados é {operator}. Contato para assuntos de privacidade: {contact}."] },
    { h: "2. Quais dados tratamos", p: [
      "E-mail (para entrar por link mágico, sem senha) e dados de perfil que você informa: nome, país, experiência, nichos, canais e preferências.",
      "Dados que você cadastra para usar o serviço: programas salvos, links, campanhas, comissões, rascunhos, produtos, anúncios e pedidos.",
      "Cliques nos seus links com rastreamento próprio: guardamos apenas um identificador diário calculado com sal, sem IP e sem cookie de rastreamento.",
      "Credenciais de integrações (por exemplo, Shopee): ficam cifradas no servidor com AES-GCM e nunca voltam ao navegador.",
      "Plano, assinatura e pagamentos registrados; e registros de auditoria (ação e data) para segurança.",
    ] },
    { h: "3. Para que usamos e em que base legal (LGPD, art. 7º)", p: [
      "Execução do contrato: criar sua conta e fornecer as funções contratadas. Legítimo interesse: segurança, prevenção a abuso e limites de uso. Obrigação legal: guarda de registros de pagamento quando exigida. Consentimento: resumo por e-mail, que é opcional e pode ser desligado a qualquer momento.",
      "Não vendemos seus dados e não usamos cookies de publicidade ou de análise de comportamento.",
    ] },
    { h: "4. Com quem compartilhamos", p: [
      "Operadores que sustentam o serviço: Cloudflare (hospedagem, banco de dados e, se ativado, modelos de IA), e o provedor de e-mail transacional, quando configurado. Redes e lojas que você conectar (como a Shopee) recebem os dados que você mandar publicar, sempre depois da sua autorização.",
      "Textos de IA são gerados a partir de dados do catálogo e do seu contexto estritamente necessário; consulte a política do provedor do modelo. Nada é publicado sem a sua revisão.",
      "Como a infraestrutura é global, pode haver transferência internacional de dados, com as salvaguardas contratuais dos operadores.",
    ] },
    { h: "5. Por quanto tempo guardamos", p: [
      "Dados da conta: até você excluí-la. Sessões: 30 dias. Códigos de login: 15 minutos. Cliques de rastreamento: 400 dias. Notificações lidas: 90 dias. Entregas de webhook: 30 dias. Registros de auditoria são mantidos de forma pseudonimizada para segurança, mesmo após a exclusão da conta. Registros de pagamento podem ser mantidos pelo prazo legal aplicável.",
    ] },
    { h: "6. Seus direitos", p: [
      "Você pode confirmar o tratamento, acessar e levar seus dados (Configurações > Exportar meus dados), corrigir o perfil, excluir a conta (Configurações > Excluir conta), revogar consentimentos, se opor a tratamentos e pedir informações sobre compartilhamento. Para outros pedidos, escreva para {contact}. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).",
    ] },
    { h: "7. Cookies", p: ["Usamos um único cookie essencial de sessão (HttpOnly, SameSite=Lax). Sem ele não é possível manter você conectado."] },
    { h: "8. Segurança", p: ["Validação no servidor, isolamento dos dados entre usuários, limites de taxa, cabeçalhos de segurança, segredos fora do navegador e registro de ações sensíveis. Nenhum sistema é totalmente imune; avisaremos sobre incidentes relevantes conforme a lei."] },
    { h: "9. Mudanças", p: ["Podemos atualizar esta política. A data de atualização aparece no topo."] },
  ],
};
const termsPt: LegalDoc = {
  title: "Termos de Uso", updated: "Atualizados em 17/11/2026",
  sections: [
    { h: "1. O que é o serviço", p: ["Ferramenta de inteligência e gestão para afiliados, operada por {operator}. Não somos rede de afiliados, corretora nem intermediamos pagamentos entre você e os programas. Contato: {contact}."] },
    { h: "2. Sem promessa de ganhos", p: ["Pontuações, simulações e recomendações são estimativas e não garantem aprovação em programas, vendas ou ganhos. Comissão estimada não é aprovada, e aprovada não é paga. Um clique não é uma venda."] },
    { h: "3. Dados de programas e produtos", p: ["O catálogo mostra a fonte e a data da última verificação de cada informação. Regras, comissões e preços mudam: confirme sempre nas condições oficiais antes de decidir."] },
    { h: "4. Suas responsabilidades", p: [
      "Cumprir os termos de cada rede, programa, loja e plataforma de anúncios; só anunciar em tráfego pago quando o programa permitir.",
      "Divulgar de forma clara a relação comercial e os links de afiliado no seu conteúdo, conforme a lei aplicável (por exemplo, CDC, CONAR e, quando aplicável, as diretrizes da FTC).",
      "Não publicar avaliações ou depoimentos falsos, nem promessas de ganhos garantidos.",
      "Manter suas credenciais seguras e responder pelo conteúdo que decidir publicar.",
    ] },
    { h: "5. Integrações e publicação", p: ["As integrações agem em seu nome e só com a sua autorização. Nada é publicado ou alterado nas lojas sem revisão e aprovação humana. Dados oficiais nunca são substituídos automaticamente."] },
    { h: "6. Planos e pagamentos", p: ["Preços, limites e período de teste são definidos pelo operador e podem mudar para períodos futuros. Pagamentos são confirmados manualmente. Sem pagamento após o vencimento e a carência, a conta volta ao plano Free e seus dados são mantidos. Você pode cancelar a qualquer momento."] },
    { h: "7. Uso aceitável", p: ["Não abuse do serviço, não tente burlar limites, não acesse dados de outras pessoas e não use o sistema para atividades ilegais."] },
    { h: "8. Encerramento", p: ["Você pode excluir a conta quando quiser. Podemos suspender contas que violem estes termos."] },
    { h: "9. Responsabilidade e lei aplicável", p: ["Na máxima extensão permitida em lei, o serviço é fornecido no estado em que se encontra. Aplica-se a legislação brasileira."] },
  ],
};

const privacyEn: LegalDoc = {
  title: "Privacy Policy", updated: "Updated 2026-11-17",
  sections: [
    { h: "1. Who is responsible", p: ["The controller of your data is {operator}. Privacy contact: {contact}."] },
    { h: "2. What data we process", p: [
      "Email (to sign in with a magic link, no password) and the profile data you provide: name, country, experience, niches, channels and preferences.",
      "Data you enter to use the service: saved programs, links, campaigns, commissions, drafts, products, listings and orders.",
      "Clicks on your own-tracking links: only a daily identifier computed with a salt, with no IP address and no tracking cookie.",
      "Integration credentials (for example Shopee): encrypted on the server with AES-GCM and never sent back to the browser.",
      "Plan, subscription and recorded payments; and audit records (action and date) for security.",
    ] },
    { h: "3. Why we use it and the legal basis (GDPR art. 6 / LGPD art. 7)", p: [
      "Performance of a contract: creating your account and providing the features. Legitimate interest: security, abuse prevention and usage limits. Legal obligation: keeping payment records where required. Consent: the email digest, which is optional and can be turned off at any time.",
      "We do not sell your data and we do not use advertising or behavioral-analytics cookies.",
    ] },
    { h: "4. Who we share it with", p: [
      "Processors that run the service: Cloudflare (hosting, database and, if enabled, AI models) and the transactional email provider, when configured. Networks and stores you connect (such as Shopee) receive the data you choose to publish, always after your approval.",
      "AI texts are generated from catalog data and only the context strictly needed; see the model provider's policy. Nothing is published without your review.",
      "Because the infrastructure is global, data may be transferred internationally, under the processors' contractual safeguards.",
    ] },
    { h: "5. How long we keep it", p: [
      "Account data: until you delete the account. Sessions: 30 days. Login codes: 15 minutes. Tracking clicks: 400 days. Read notifications: 90 days. Webhook deliveries: 30 days. Audit records are kept pseudonymized for security, even after account deletion. Payment records may be kept for the applicable legal period.",
    ] },
    { h: "6. Your rights", p: [
      "You can confirm processing, access and port your data (Settings > Export my data), correct your profile, delete your account (Settings > Delete account), withdraw consent, object to processing and ask about sharing. For other requests write to {contact}. You may also complain to your data protection authority.",
    ] },
    { h: "7. Cookies", p: ["We use a single essential session cookie (HttpOnly, SameSite=Lax). Without it we cannot keep you signed in."] },
    { h: "8. Security", p: ["Server-side validation, data isolation between users, rate limits, security headers, secrets kept out of the browser and logging of sensitive actions. No system is fully immune; we will report relevant incidents as the law requires."] },
    { h: "9. Changes", p: ["We may update this policy. The update date is shown at the top."] },
  ],
};
const termsEn: LegalDoc = {
  title: "Terms of Use", updated: "Updated 2026-11-17",
  sections: [
    { h: "1. What the service is", p: ["An intelligence and management tool for affiliates, operated by {operator}. We are not an affiliate network or broker and we do not handle payments between you and the programs. Contact: {contact}."] },
    { h: "2. No earnings promise", p: ["Scores, simulations and recommendations are estimates and do not guarantee program approval, sales or earnings. An estimated commission is not approved, and approved is not paid. A click is not a sale."] },
    { h: "3. Program and product data", p: ["The catalog shows the source and the last verification date of each item. Rules, commissions and prices change: always check the official terms before deciding."] },
    { h: "4. Your responsibilities", p: [
      "Follow the terms of each network, program, store and ad platform; run paid traffic only where the program allows it.",
      "Clearly disclose the commercial relationship and affiliate links in your content, as the applicable law requires (for example the FTC Endorsement Guides in the US, and consumer and advertising rules elsewhere).",
      "Do not publish fake reviews or testimonials, or guaranteed-earnings claims.",
      "Keep your credentials safe and answer for the content you decide to publish.",
    ] },
    { h: "5. Integrations and publishing", p: ["Integrations act on your behalf and only with your authorization. Nothing is published or changed in stores without human review and approval. Official data is never replaced automatically."] },
    { h: "6. Plans and payments", p: ["Prices, limits and the trial period are set by the operator and may change for future periods. Payments are confirmed manually. With no payment after expiry and the grace period, the account returns to the Free plan and your data is kept. You may cancel at any time."] },
    { h: "7. Acceptable use", p: ["Do not abuse the service, bypass limits, access other people's data or use the system for unlawful activity."] },
    { h: "8. Termination", p: ["You may delete your account whenever you like. We may suspend accounts that breach these terms."] },
    { h: "9. Liability and governing law", p: ["To the maximum extent permitted by law the service is provided as is. Brazilian law applies."] },
  ],
};

const privacyEs: LegalDoc = {
  title: "Política de Privacidad", updated: "Actualizada el 17/11/2026",
  sections: [
    { h: "1. Quién es el responsable", p: ["El responsable de tus datos es {operator}. Contacto de privacidad: {contact}."] },
    { h: "2. Qué datos tratamos", p: [
      "Correo electrónico (para entrar con enlace mágico, sin contraseña) y los datos de perfil que indiques: nombre, país, experiencia, nichos, canales y preferencias.",
      "Datos que cargas para usar el servicio: programas guardados, enlaces, campañas, comisiones, borradores, productos, anuncios y pedidos.",
      "Clics en tus enlaces con seguimiento propio: solo guardamos un identificador diario calculado con sal, sin IP y sin cookie de seguimiento.",
      "Credenciales de integraciones (por ejemplo, Shopee): se cifran en el servidor con AES-GCM y nunca vuelven al navegador.",
      "Plan, suscripción y pagos registrados; y registros de auditoría (acción y fecha) por seguridad.",
    ] },
    { h: "3. Para qué los usamos y base legal (RGPD art. 6 / LGPD art. 7)", p: [
      "Ejecución del contrato: crear tu cuenta y ofrecer las funciones. Interés legítimo: seguridad, prevención de abusos y límites de uso. Obligación legal: conservar registros de pago cuando se exija. Consentimiento: el resumen por correo, que es opcional y se puede desactivar en cualquier momento.",
      "No vendemos tus datos ni usamos cookies de publicidad o de análisis de comportamiento.",
    ] },
    { h: "4. Con quién los compartimos", p: [
      "Encargados que sostienen el servicio: Cloudflare (alojamiento, base de datos y, si se activa, modelos de IA) y el proveedor de correo transaccional, cuando está configurado. Las redes y tiendas que conectes (como Shopee) reciben los datos que decidas publicar, siempre después de tu autorización.",
      "Los textos de IA se generan con datos del catálogo y solo el contexto estrictamente necesario; consulta la política del proveedor del modelo. Nada se publica sin tu revisión.",
      "Como la infraestructura es global, puede haber transferencia internacional de datos, con las garantías contractuales de los encargados.",
    ] },
    { h: "5. Cuánto tiempo los conservamos", p: [
      "Datos de la cuenta: hasta que la elimines. Sesiones: 30 días. Códigos de acceso: 15 minutos. Clics de seguimiento: 400 días. Notificaciones leídas: 90 días. Entregas de webhook: 30 días. Los registros de auditoría se conservan seudonimizados por seguridad, incluso tras eliminar la cuenta. Los registros de pago pueden conservarse el plazo legal aplicable.",
    ] },
    { h: "6. Tus derechos", p: [
      "Puedes confirmar el tratamiento, acceder a tus datos y llevártelos (Ajustes > Exportar mis datos), corregir el perfil, eliminar la cuenta (Ajustes > Eliminar cuenta), retirar consentimientos, oponerte al tratamiento y pedir información sobre el uso compartido. Para otras solicitudes escribe a {contact}. También puedes reclamar ante tu autoridad de protección de datos.",
    ] },
    { h: "7. Cookies", p: ["Usamos una única cookie esencial de sesión (HttpOnly, SameSite=Lax). Sin ella no podemos mantenerte conectado."] },
    { h: "8. Seguridad", p: ["Validación en el servidor, aislamiento de datos entre usuarios, límites de tasa, cabeceras de seguridad, secretos fuera del navegador y registro de acciones sensibles. Ningún sistema es totalmente inmune; informaremos de incidentes relevantes según exige la ley."] },
    { h: "9. Cambios", p: ["Podemos actualizar esta política. La fecha de actualización aparece arriba."] },
  ],
};
const termsEs: LegalDoc = {
  title: "Términos de Uso", updated: "Actualizados el 17/11/2026",
  sections: [
    { h: "1. Qué es el servicio", p: ["Herramienta de inteligencia y gestión para afiliados, operada por {operator}. No somos una red de afiliados ni un corredor, y no intermediamos pagos entre tú y los programas. Contacto: {contact}."] },
    { h: "2. Sin promesa de ganancias", p: ["Las puntuaciones, simulaciones y recomendaciones son estimaciones y no garantizan aprobación en programas, ventas ni ganancias. Una comisión estimada no es aprobada, y aprobada no es pagada. Un clic no es una venta."] },
    { h: "3. Datos de programas y productos", p: ["El catálogo muestra la fuente y la fecha de la última verificación de cada dato. Las reglas, comisiones y precios cambian: confirma siempre en las condiciones oficiales antes de decidir."] },
    { h: "4. Tus responsabilidades", p: [
      "Cumplir los términos de cada red, programa, tienda y plataforma de anuncios; hacer tráfico de pago solo cuando el programa lo permita.",
      "Divulgar con claridad la relación comercial y los enlaces de afiliado en tu contenido, según la ley aplicable (por ejemplo, las guías de la FTC en EE. UU. y las normas de consumo y publicidad de cada país).",
      "No publicar reseñas ni testimonios falsos, ni promesas de ganancias garantizadas.",
      "Mantener tus credenciales seguras y responder por el contenido que decidas publicar.",
    ] },
    { h: "5. Integraciones y publicación", p: ["Las integraciones actúan en tu nombre y solo con tu autorización. Nada se publica ni se cambia en las tiendas sin revisión y aprobación humana. Los datos oficiales nunca se reemplazan automáticamente."] },
    { h: "6. Planes y pagos", p: ["Los precios, límites y el período de prueba los define el operador y pueden cambiar para períodos futuros. Los pagos se confirman manualmente. Sin pago tras el vencimiento y la gracia, la cuenta vuelve al plan Free y tus datos se conservan. Puedes cancelar en cualquier momento."] },
    { h: "7. Uso aceptable", p: ["No abuses del servicio, no evites los límites, no accedas a datos de otras personas ni uses el sistema para actividades ilegales."] },
    { h: "8. Terminación", p: ["Puedes eliminar tu cuenta cuando quieras. Podemos suspender cuentas que incumplan estos términos."] },
    { h: "9. Responsabilidad y ley aplicable", p: ["En la máxima medida permitida por la ley, el servicio se ofrece tal cual. Se aplica la legislación brasileña."] },
  ],
};

export const LEGAL: Record<Locale, { privacy: LegalDoc; terms: LegalDoc }> = {
  "pt-BR": { privacy: privacyPt, terms: termsPt },
  "en-US": { privacy: privacyEn, terms: termsEn },
  es: { privacy: privacyEs, terms: termsEs },
};
