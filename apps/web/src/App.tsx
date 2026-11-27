import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { useI18n } from "./i18n";
import { Login } from "./pages/Login";
import { Verify } from "./pages/Verify";

const Admin = lazy(() => import("./pages/Admin").then((m) => ({ default: m.Admin })));
const Alerts = lazy(() => import("./pages/Alerts").then((m) => ({ default: m.Alerts })));
const Catalog = lazy(() => import("./pages/Catalog").then((m) => ({ default: m.Catalog })));
const Compare = lazy(() => import("./pages/Compare").then((m) => ({ default: m.Compare })));
const ProgramDetail = lazy(() => import("./pages/ProgramDetail").then((m) => ({ default: m.ProgramDetail })));
const Programs = lazy(() => import("./pages/Programs").then((m) => ({ default: m.Programs })));
const Recommendations = lazy(() => import("./pages/Recommendations").then((m) => ({ default: m.Recommendations })));
const Simulator = lazy(() => import("./pages/Simulator").then((m) => ({ default: m.Simulator })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Onboarding = lazy(() => import("./pages/Onboarding").then((m) => ({ default: m.Onboarding })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const MyPrograms = lazy(() => import("./pages/MyPrograms").then((m) => ({ default: m.MyPrograms })));
const Links = lazy(() => import("./pages/Links").then((m) => ({ default: m.Links })));
const Campaigns = lazy(() => import("./pages/Campaigns").then((m) => ({ default: m.Campaigns })));
const Commissions = lazy(() => import("./pages/Commissions").then((m) => ({ default: m.Commissions })));
const Integrations = lazy(() => import("./pages/Integrations").then((m) => ({ default: m.Integrations })));
const Orders = lazy(() => import("./pages/Orders").then((m) => ({ default: m.Orders })));
const Automations = lazy(() => import("./pages/Automations").then((m) => ({ default: m.Automations })));
const Notifications = lazy(() => import("./pages/Notifications").then((m) => ({ default: m.Notifications })));
const StoreBuilder = lazy(() => import("./pages/StoreBuilder").then((m) => ({ default: m.StoreBuilder })));
const Seasonal = lazy(() => import("./pages/Seasonal").then((m) => ({ default: m.Seasonal })));
const AdStudio = lazy(() => import("./pages/AdStudio").then((m) => ({ default: m.AdStudio })));
const Assistant = lazy(() => import("./pages/Assistant").then((m) => ({ default: m.Assistant })));
const Billing = lazy(() => import("./pages/Billing").then((m) => ({ default: m.Billing })));
const Reports = lazy(() => import("./pages/Reports").then((m) => ({ default: m.Reports })));
const Content = lazy(() => import("./pages/Content").then((m) => ({ default: m.Content })));
const Legal = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Legal })));

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
    <Suspense fallback={<p className="p-8 text-center text-slate-500">{t("common.loading")}</p>}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/privacy" element={<Legal kind="privacy" />} />
      <Route path="/terms" element={<Legal kind="terms" />} />
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
        <Route path="/automations" element={<Protected><Automations /></Protected>} />
        <Route path="/notifications" element={<Protected><Notifications /></Protected>} />
        <Route path="/billing" element={<Protected><Billing /></Protected>} />
        <Route path="/reports" element={<Protected><Reports /></Protected>} />
        <Route path="/orders" element={<Protected><Orders /></Protected>} />
        <Route path="/store" element={<Protected><StoreBuilder /></Protected>} />
        <Route path="/seasonal" element={<Protected><Seasonal /></Protected>} />
        <Route path="/week" element={<Protected><Content /></Protected>} />
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
    </Suspense>
  );
}
