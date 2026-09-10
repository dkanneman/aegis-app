import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/pepper",
    name: "Pepper Family Concierge",
    short_name: "Pepper",
    description:
      "Pepper brings together email, school events, chores, tasks, and appointments into a daily flow ordered by importance.",
    start_url: "/pepper",
    scope: "/",
    display: "standalone",
    background_color: "#F6F5FB",
    theme_color: "#D9DEF2",
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
