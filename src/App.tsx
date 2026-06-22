import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { CRM } from "./components/atomic-crm/root/CRM";
import { VoiceChannelProvider } from "./components/voice/VoiceChannelProvider";
import { AutoplayManager } from "./components/voice/AutoplayManager";
import { ChunkErrorBoundary } from "./components/ChunkErrorBoundary";
import { useVersionPoll } from "./lib/useVersionPoll";
import { useMe } from "./lib/useMe";

// Single-tenant build. Cloudflare Access gates the entire origin — any request
// that reaches the SPA is already the allow-listed user. No client-side auth
// negotiation, no hosted login redirect, no token plumbing.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function VersionPollMount() {
  useVersionPoll();
  return null;
}

// Inside the QueryClientProvider so it can resolve the real identity via useMe.
// A "move" user (Noa) gets just the scoped CRM — NO voice subsystem, because
// /api/voice* is owner-only and would 403-spam the 5s feed poll.
function AppShell() {
  const { role, isLoading } = useMe();

  if (isLoading) return null;

  if (role === "move") return <CRM />;

  return (
    <VoiceChannelProvider>
      <VersionPollMount />
      <AutoplayManager />
      <CRM />
    </VoiceChannelProvider>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ChunkErrorBoundary>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </ChunkErrorBoundary>
  </QueryClientProvider>
);

export default App;
