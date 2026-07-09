-- D&D Adventure section for the dashboard's Sites page.
-- sort_order 50-62: the next free block after PAI & Tools (40s).
-- Idempotent: re-running replaces the same ids rather than duplicating the section.

INSERT OR REPLACE INTO deployed_sites (id, project, name, url, note, sort_order) VALUES
  ('site-014', 'D&D Adventure', 'Play script — the DM scroll',   'https://dnd-adventure.pages.dev/',              'Main page. Full 8-beat Hebrew script, voice buttons, sticky nav.', 50),

  ('site-015', 'D&D Adventure', 'Ron — שמנמניתה',                 'https://dnd-adventure.pages.dev/char-ron',      'Half-Elf Barbarian. Live HP tracker + printable PDF.',            51),
  ('site-016', 'D&D Adventure', 'Itamar — Elf Rogue',             'https://dnd-adventure.pages.dev/char-itamar',   'Elf Rogue. Live HP tracker + printable PDF.',                     52),
  ('site-017', 'D&D Adventure', 'Jonathan — sardior',             'https://dnd-adventure.pages.dev/char-jonathan', 'Dragonborn Monk. Live HP tracker + printable PDF.',               53),

  ('site-018', 'D&D Adventure', 'Gorilla — the King''s test',     'https://dnd-adventure.pages.dev/npc-gorilla',   'Beat 2 boss. AC 13 / HP 45 (the riddle answer). DM-only card.',   54),
  ('site-019', 'D&D Adventure', 'Giant Bird — final boss',        'https://dnd-adventure.pages.dev/npc-bird',      'Beat 8. Airborne, dives to charge, 3 fairy revives.',             55),
  ('site-020', 'D&D Adventure', 'Dora & Boots',                   'https://dnd-adventure.pages.dev/npc-dora',      'Beat 4 NPC. Boots joins as the 4th character.',                   56),

  ('site-021', 'D&D Adventure', 'Companion — Eagle 🦅',           'https://dnd-adventure.pages.dev/npc-eagle',     'd4=1. Cannot see straight; always attacks to the left.',          57),
  ('site-022', 'D&D Adventure', 'Companion — Monkey 🐒',          'https://dnd-adventure.pages.dev/npc-monkey',    'd4=2. Banana-obsessed.',                                          58),
  ('site-023', 'D&D Adventure', 'Companion — Saber Tiger 🐯',     'https://dnd-adventure.pages.dev/npc-tiger',     'd4=3. Enormous cat, tiny teeth.',                                 59),
  ('site-024', 'D&D Adventure', 'Companion — Frog 🐸',            'https://dnd-adventure.pages.dev/npc-frog',      'd4=4. Must jump before it does anything.',                        60),

  ('site-025', 'D&D Adventure', 'Newspaper — the theft',          'https://dnd-adventure.pages.dev/newspaper',     'Scene 1 prop. Front page: the giant bird steals the gold.',       61),
  ('site-026', 'D&D Adventure', 'Newspaper — the finale',         'https://dnd-adventure.pages.dev/newspaper2',    'Beat 8 prop. Heroes return the gold; steak + high-fives payoff.', 62);
