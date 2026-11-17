# Segurança e privacidade (Fase 9)

## Controles implementados e como são verificados
| Controle | Onde | Teste |
| --- | --- | --- |
| Toda rota `/api/*` exige sessão, exceto uma lista curta (saúde, contato legal, login, verificação, gancho de entrada por token, descadastro assinado) | `middleware.ts` | `security.test.ts` percorre **todas** as rotas registradas e falha se alguma responder sem sessão |
| Rotas `/api/admin*` só para administrador | `requireRole` | idem, com usuário comum |
| Isolamento entre usuários (todo dado privado tem `user_id` em toda consulta) | `ops.ts`, `market.ts`... | `security.test.ts` (ler/alterar/apagar registro alheio → 403/404) e testes por módulo |
| CSRF: SameSite=Lax + cabeçalho `X-Requested-With` + conferência de `Origin` | `app.ts` | `security.test.ts` |
| Login sem senha (link mágico de uso único, 15 min, só o hash é guardado), resposta igual para conta existente ou não, limite por IP e por e-mail | `app.ts` | `api.test.ts`, `security.test.ts` |
| Sessão: cookie HttpOnly, Secure (em HTTPS), SameSite=Lax; 30 dias; só o hash no banco; logout invalida | `app.ts` | `security.test.ts` |
| Validação no servidor (zod) em toda entrada; consultas parametrizadas (nenhuma concatenação de dado do usuário em SQL) | todos | revisão + testes de entrada inválida |
| Limite de corpo de 2 MB | `app.ts` | `security.test.ts` |
| Cabeçalhos: API com CSP `default-src 'none'`, `no-store`, HSTS, nosniff; frontend com CSP restrita, HSTS, X-Frame-Options, Permissions-Policy via `apps/web/public/_headers` | `app.ts`, `_headers` | `security.test.ts` (API); `_headers` é conferido pelo teste de fumaça do deploy |
| XSS: React escapa por padrão; não há `dangerouslySetInnerHTML`; CSP sem `unsafe-eval` e sem scripts inline | web | revisão (`grep dangerouslySetInnerHTML`) |
| Segredos fora do navegador; credenciais de integração cifradas com AES-GCM (`CREDENTIALS_KEY`), mostradas uma vez | `vault.ts` | `integrations` testes |
| SSRF: webhooks e importações só em `https`, hosts públicos, sem seguir redirecionamentos | `automation.ts`, `integrations.ts` | `audit-fixes.test.ts` |
| Auditoria de ações sensíveis (login, papel, plano, pagamento, publicação, exclusão) | `audit.ts` | testes por módulo |
| Retenção/minimização: limpeza diária de sessões vencidas, limites de taxa, cliques > 400 dias, notificações lidas > 90 dias, entregas > 30 dias | `purgeOld` | `security.test.ts` |
| Exportação e exclusão de conta (LGPD art. 18) | `/api/me/export`, `DELETE /api/me` | `security.test.ts`, `billing.test.ts` |
| Páginas públicas de Privacidade e Termos (PT/EN/ES), com controlador e contato definidos pelo administrador | `Legal.tsx`, `/api/legal` | `billing`/`pages` testes |
| Divulgação de afiliado e proibição de avaliações falsas/promessa de ganho | Estúdio, Termos | testes do estúdio |

## Auditoria de dependências
`npm audit` (5 achados "altos" na auditoria de 17/11/2026):
- **picomatch** (ReDoS): só ferramentas de build/teste (vite, vitest); não vai para produção. O CI audita só dependências de produção.
- **zod** (consumo de memória ao validar listas enormes com muitos itens inválidos): o aviso cita versões até a 4.6.5 e não confirma a 3.x, que é a usada. Mitigação aplicada: limite de corpo de 2 MB antes da validação. **Atualizar para zod 4 foi testado e NÃO foi feito**: na v4, `.partial()` mantém os valores padrão (`.default("unverified")`), então editar um programa reescreveria campos não enviados com "não verificado" — apagaria dados confirmados. A migração exige reescrever os esquemas de edição sem padrões; fica como tarefa planejada (5 testes existentes já a detectam).
- O CI falha em vulnerabilidade **crítica** de produção e avisa nas altas.

## O que NÃO foi feito / riscos residuais
- Os textos de Privacidade e Termos são um **modelo** escrito a partir do que o sistema faz. Antes de operar comercialmente, revise com assessoria jurídica (LGPD, e GDPR/CCPA se houver usuários fora do Brasil) e preencha operador e contato em Admin > Privacidade e termos.
- Sem 2FA: o login é por link no e-mail; a segurança da conta é a do e-mail do usuário.
- Sem teste de invasão externo. As verificações acima são automáticas e de revisão.
- Cabeçalho CSP do frontend usa `style-src 'unsafe-inline'` (estilos inline do React). Scripts não têm exceção.
- Excluir a conta apaga também os pagamentos (cascata); avalie retenção fiscal.
- Rate limit está nas rotas sensíveis (login, publicação, IA, entrada de webhooks), não em todas.

## Resposta a incidentes (resumo)
1. Conter: revogar sessões (`DELETE FROM sessions`), girar `CREDENTIALS_KEY`/`CLICK_SALT`/`RESEND_API_KEY` (`wrangler secret put`). Girar `CREDENTIALS_KEY` exige recadastrar credenciais das integrações.
2. Avaliar: consultar `audit_logs` (Admin > Auditoria).
3. Comunicar: titulares e ANPD quando houver risco relevante (LGPD art. 48).
4. Restaurar se necessário: `docs/BACKUP.md`.
