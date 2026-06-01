import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { CRM } from "./components/atomic-crm/root/CRM";
import { VoiceChannelProvider } from "./components/voice/VoiceChannelProvider";
import { AutoplayManager } from "./components/voice/AutoplayManager";
import { ChunkErrorBoundary } from "./components/ChunkErrorBoundary";
import { useVersionPoll } from "./lib/useVersionPoll";

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ChunkErrorBoundary>
      <BrowserRouter>
        <VoiceChannelProvider>
          <VersionPollMount />
          <AutoplayManager />
          <CRM />
        </VoiceChannelProvider>
      </BrowserRouter>
    </ChunkErrorBoundary>
  </QueryClientProvider>
);

export default App;
