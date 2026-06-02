const BANNER_URL =
  "https://pub-f9d4dc80715b4656bb344d288227078e.r2.dev/assets/rick-field-banner.webp";

// Onboarding command buttons and the 3 placeholder pitch-deck cards were removed
// 2026-06-02 (hardcoded/demo cleanup) — the decks' page_content rows were deleted,
// so the cards would have 404'd. HomePage is now just the banner.
export function HomePage() {
  return (
    <div className="w-full">
      {/* Banner */}
      <div className="relative mb-6 h-[512px] overflow-hidden rounded-xl bg-muted">
        <img
          src={BANNER_URL}
          alt="Rick standing in a sunset field of alien grass"
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="h-full w-full object-cover object-bottom"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 px-8 pb-8">
          <h1 className="text-4xl font-bold text-white drop-shadow-md">Home</h1>
          <p className="mt-2 max-w-2xl text-base text-white/85 drop-shadow">
            A field. A man. Some plants with too many limbs. Welcome to the dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}

HomePage.path = "/home";
