import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/pepper",
    name: "Pepper Family Concierge",
    short_name: "Pepper",
    description:
      "A calm family concierge for schedules, responsibilities, and the things that need follow-through.",
    start_url: "/pepper",
    scope: "/",
    display: "standalone",
    background_color: "#F7F4EE",
    theme_color: "#F7F4EE",
    categories: ["lifestyle", "productivity"],
    icons: [
      {
        src: "/pepper-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pepper-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pepper-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
