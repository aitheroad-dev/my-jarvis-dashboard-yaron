// Domain types for the Israel hiking planner.

export interface PointOfInterest {
  id: string;
  name: string;
  description: string;
  region: string;
  lat: number | null;
  lng: number | null;
  tags: string[];
  imageUrl: string;
  googleUrl?: string;
  createdDate: string;
}

export interface FieldNote {
  id: string;
  pointOfInterestId: string;
  text: string;
  date: string; // YYYY-MM-DD — the date the observation refers to
  createdDate: string; // ISO timestamp when the note was saved
}
