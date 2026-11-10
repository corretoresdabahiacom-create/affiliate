import { CHANNELS, EXPERIENCE, NICHES, type ProfileInput } from "@ai/shared";
import { useState, type FormEvent } from "react";
import type { Me } from "../api";
import { useI18n, type MessageKey } from "../i18n";

type Profile = NonNullable<Me["profile"]>;

export function ProfileForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: Profile | null;
  submitLabel: string;
  onSubmit: (p: Partial<ProfileInput>) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [country, setCountry] = useState(initial?.country ?? "");
  const [experience, setExperience] = useState(initial?.experience ?? "");
  const [niches, setNiches] = useState<string[]>(initial?.niches ?? []);
  const [channels, setChannels] = useState<string[]>(initial?.channels ?? []);
  const [hasWebsite, setHasWebsite] = useState(initial?.hasWebsite ?? false);
  const [budget, setBudget] = useState(initial?.monthlyBudgetUsd?.toString() ?? "");
  const [wantsRecurring, setWantsRecurring] = useState(initial?.wantsRecurring ?? false);
  const [paid, setPaid] = useState(initial?.acceptsPaidTraffic ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        displayName: displayName.trim() || undefined,
        locale,
        country: country.trim() ? country.trim().toUpperCase() : undefined,
        experience: (experience || undefined) as ProfileInput["experience"],
        niches: niches as ProfileInput["niches"],
        channels: channels as ProfileInput["channels"],
        hasWebsite,
        monthlyBudgetUsd: budget === "" ? undefined : Math.max(0, Math.round(Number(budget))),
        wantsRecurring,
        acceptsPaidTraffic: paid,
      });
    } catch {
      setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="label" htmlFor="displayName">
          {t("profile.displayName")}
        </label>
        <input id="displayName" className="input" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="country">
            {t("profile.country")}
          </label>
          <input id="country" className="input" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="experience">
            {t("profile.experience")}
          </label>
          <select id="experience" className="input" value={experience} onChange={(e) => setExperience(e.target.value)}>
            <option value="" />
            {EXPERIENCE.map((x) => (
              <option key={x} value={x}>
                {t(`experience.${x}` as MessageKey)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="label">{t("profile.niches")}</legend>
        <div className="flex flex-wrap gap-3">
          {NICHES.map((n) => (
            <label key={n} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={niches.includes(n)} onChange={() => toggle(niches, setNiches, n)} />
              {t(`niche.${n}` as MessageKey)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">{t("profile.channels")}</legend>
        <div className="flex flex-wrap gap-3">
          {CHANNELS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={channels.includes(c)} onChange={() => toggle(channels, setChannels, c)} />
              {t(`channel.${c}` as MessageKey)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="budget">
            {t("profile.budget")}
          </label>
          <input id="budget" type="number" min={0} className="input" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
        <div className="space-y-2 pt-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hasWebsite} onChange={(e) => setHasWebsite(e.target.checked)} />
            {t("profile.hasWebsite")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wantsRecurring} onChange={(e) => setWantsRecurring(e.target.checked)} />
            {t("profile.wantsRecurring")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            {t("profile.acceptsPaidTraffic")}
          </label>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button className="btn" disabled={busy}>
        {busy ? t("common.loading") : submitLabel}
      </button>
    </form>
  );
}
