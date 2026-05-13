import {
  getInterviewPreps,
  getStoryBank,
  getRoles,
  getStats,
  getConfig,
  getSignals,
} from "@/lib/data";
import { InterviewsPage } from "./interviews-client";

export const dynamic = "force-dynamic";

export default function Page() {
  const preps = getInterviewPreps();
  const storyBank = getStoryBank();
  const roles = getRoles();
  const stats = getStats();
  const config = getConfig();
  const signals = getSignals();

  const interviewRoles = roles.filter((r) => r.status === "Interview");
  const highConviction = signals.filter((s) => s.result === "high").length;
  const companyCount = config.ashby.length + config.greenhouse.length;

  return (
    <InterviewsPage
      preps={preps}
      storyBank={storyBank}
      interviewRoles={interviewRoles}
      interviewCount={stats.interviews}
      activePursuing={stats.activelyPursuing}
      highConviction={highConviction}
      companyCount={companyCount}
      signalCount={signals.length}
      hasWarmLeads={stats.hasWarmLeads}
    />
  );
}
