import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Menu, MessageCircle } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { VoiceFeedBody } from "@/components/voice/VoicePanel";
import { navItems, NavLink } from "./nav-items";
import { useMe } from "@/lib/useMe";

export function MobileTopBar({ voiceEnabled }: { voiceEnabled: boolean }) {
  const [navOpen, setNavOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const location = useLocation();
  const { isOwner, pages } = useMe();
  const items = isOwner ? navItems : navItems.filter((item) => pages.has(item.key));

  useEffect(() => {
    setNavOpen(false);
    setVoiceOpen(false);
  }, [location.pathname]);

  return (
    <header className="sticky top-0 z-40 flex items-center gap-3 border-b bg-sidebar px-3 py-2.5 md:hidden">
      {/* Left: hamburger → nav Sheet */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label="Open navigation"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="flex w-72 max-w-[85vw] flex-col gap-0 bg-sidebar p-0"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="border-b px-4 py-4">
            <span className="text-sm font-semibold">Dashboard</span>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-4">
            {items.map((item) => (
              <NavLink key={item.to} item={item} />
            ))}
          </nav>
        </SheetContent>
      </Sheet>

      {/* Title */}
      <span className="text-sm font-semibold">Dashboard</span>

      {/* Right: voice button → full-screen voice Sheet. Owner-only — guests have
          no voice subsystem, so the button (and its VoiceFeedBody) must not render. */}
      {voiceEnabled && (
      <div className="ml-auto">
        <Sheet open={voiceOpen} onOpenChange={setVoiceOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Open voice feed"
              className="relative flex h-9 w-9 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <MessageCircle className="h-[18px] w-[18px]" />
            </button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-screen max-w-none border-l-0 p-0 sm:max-w-none"
          >
            <SheetTitle className="sr-only">Voice feed</SheetTitle>
            <VoiceFeedBody onClose={() => setVoiceOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
      )}
    </header>
  );
}
