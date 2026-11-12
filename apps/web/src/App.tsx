import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { useI18n } from "./i18n";
import { Admin } from "./pages/Admin";
import { Alerts } from "./pages/Alerts";
import { Catalog } from "./pages/Catalog";
import { Compare } from "./pages/Compare";
import { ProgramDetail } from "./pages/ProgramDetail";
import { Programs } from "./pages/Programs";
import { Recommendations } from "./pages/Recommendations";
import { Simulator } from "./pages/Simulator";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Settings } from "./pages/Settings";
import { Verify } from "./pages/Verify";
import { MyPrograms } from "./pages/MyPrograms";
import { Links } from "./pages/Links";
import { Campaigns } from "./pages/Campaigns";
import { Commissions } from "./pages/Commissions";
import { Integrations } from "./pages/Integrations";
import { Orders } from "./pages/Orders";
import { StoreBuilder } from "./pages/StoreBuilder";
import { Seasonal } from "./pages/Seasonal";
import { AdStudio } from "./pages/AdStudio";
import { Assistant } from "./pages/Assistant";

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
        <Route path="/my-programs" element={<Protected><MyPrograms /></Protected>} />
        <Route path="/links" element={<Protected><Links /></Protected>} />
        <Route path="/campaigns" element={<Protected><Campaigns /></Protected>} />
        <Route path="/commissions" element={<Protected><Commissions /></Protected>} />
        <Route path="/integrations" element={<Protected><Integrations /></Protected>} />
        <Route path="/orders" element={<Protected><Orders /></Protected>} />
        <Route path="/store" element={<Protected><StoreBuilder /></Protected>} />
        <Route path="/seasonal" element={<Protected><Seasonal /></Protected>} />
        <Route path="/studio" element={<Protected><AdStudio /></Protected>} />
        <Route path="/assistant" element={<Protected><Assistant /></Protected>} />
        <Route path="/recommendations" element={<Protected><Recommendations /></Protected>} />
        <Route path="/compare" element={<Protected><Compare /></Protected>} />
        <Route path="/simulator" element={<Protected><Simulator /></Protected>} />
        <Route path="/alerts" element={<Protected><Alerts /></Protected>} />
        <Route path="/catalog" element={<Protected><Catalog /></Protected>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<p>{t("error.notFound")}</p>} />
      </Route>
    </Routes>
  );
}
