import type { ProviderKind, ProviderPort } from "@altrion/shared";

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderPort>();

  register(provider: ProviderPort): void {
    this.providers.set(this.key(provider.providerKind, provider.providerName), provider);
  }

  get<TProvider extends ProviderPort>(
    providerKind: ProviderKind,
    providerName: string
  ): TProvider | null {
    return (
      (this.providers.get(this.key(providerKind, providerName)) as TProvider | undefined) ?? null
    );
  }

  list(providerKind?: ProviderKind): readonly ProviderPort[] {
    const values = Array.from(this.providers.values());

    if (!providerKind) {
      return values;
    }

    return values.filter((provider) => provider.providerKind === providerKind);
  }

  private key(providerKind: ProviderKind, providerName: string): string {
    return `${providerKind}:${providerName}`;
  }
}
