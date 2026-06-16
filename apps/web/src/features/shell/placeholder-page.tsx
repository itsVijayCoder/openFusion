type PlaceholderPageProps = {
  title: string;
  description: string;
};

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">Fusion Harness</p>
        <h1 className="text-3xl font-semibold text-foreground">{title}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      </header>
      <section className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        This screen is scaffolded for the monorepo foundation phase.
      </section>
    </main>
  );
}
