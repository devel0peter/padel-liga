import { groupOf4Rounds } from "@padel-liga/rules";

import type { Route } from "./+types/home";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Padel Liga" },
    { name: "description", content: "Heti páros padelliga Győrben." },
  ];
}

// Placeholder until the Phase 0 landing page moves here.
export default function Home() {
  const rounds = groupOf4Rounds(["1.", "2.", "3.", "4."]);
  return (
    <main className="mx-auto max-w-xl p-4 pt-16">
      <Card>
        <CardHeader>
          <CardTitle>Padel Liga</CardTitle>
          <CardDescription>Hamarosan. Egy 4 páros csoport sorsolása:</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ol className="list-decimal pl-5">
            {rounds.map((round, i) => (
              <li key={i}>
                {round.map(([a, b]) => `${a}–${b}`).join(", ")}
              </li>
            ))}
          </ol>
          <Button>Jelentkezem</Button>
        </CardContent>
      </Card>
    </main>
  );
}
