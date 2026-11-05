// The sentences of the "Mi az értékszám?" explanation on the profile (#135,
// shortened in #177): at most three, all to one player ("te"). The third
// one is only there until the first final match changes the rating (#13).
export function ratingExplanation(rated: boolean): string[] {
  const sentences = [
    "Az értékszám azt mutatja, mennyire vagy erős: a szintedből indul (kezdő 1000, középhaladó 1200, haladó 1400, versenyző 1600).",
    "Minden lejátszott meccs után változik: erősebb pár ellen nyerve sokat kapsz, gyengébb ellen keveset, vereségnél fordítva.",
  ];
  if (!rated) sentences.push("Most még a kezdő értékszámodat látod.");
  return sentences;
}
