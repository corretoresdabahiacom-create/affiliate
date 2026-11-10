import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { useI18n } from "./i18n";
import { Admin } from "./pages/Admin";
import { Catalog } from "./pages/Catalog";
import { ProgramDetail } from "./pages/ProgramDetail";
import { Programs } from "./pages/Programs";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Settings } from "./pages/Settings";
import { Verify } from "./pages/Verify";

/** Exige sessão; quem ainda não fez o onboarding é levado a ele. */
function Protected({ children, requireOnboarded = true }: { children: React.ReactNode; requireOnboarded?: boolean }) {
  const { me, loading } = useAuth();
  const { t } = useI18n();
  if (loading) return <p className="p-8 text-center text-slate-500">{t("common.loading")}</p>;
  if (!me) return <Navigate to="/login" replace />;
  if (requireOnboarded && me.profile && !me.profile.onboarded) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export function App() {
  const { t } = useI18n();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/verify" element={<Verify />} />
      <Route
        element={
          <Protected requireOnboarded={false}>
            <Layout />
          </Protected>
        }
      >
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/" element={<Protected><Dashboard /></Protected>} />
        <Route path="/programs" element={<Protected><Programs /></Protected>} />
        <Route path="/programs/:id" element={<Protected><ProgramDetail /></Protected>} />
        <Route path="/catalog" element={<Protected><Catalog /></Protected>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<p>{t("error.notFound")}</p>} />
      </Route>
    </Routes>
  );
}
