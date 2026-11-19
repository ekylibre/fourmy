import { Component, type ReactNode } from "react";

/**
 * Isole une partie de page : en cas d'erreur de rendu, `fallback` la remplace
 * (le reste de la page reste utilisable) et `reset` la réessaie. `resetKey` :
 * une nouvelle valeur (autre étape, autre page) efface l'erreur.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; fallback: (error: unknown, reset: () => void) => ReactNode; resetKey?: unknown; label?: string },
  { error: unknown; key: unknown }
> {
  override state: { error: unknown; key: unknown } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error("Erreur inconnue") };
  }

  static getDerivedStateFromProps(props: { resetKey?: unknown }, state: { error: unknown; key: unknown }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  override componentDidCatch(error: unknown) {
    console.error(`[${this.props.label ?? "page"}]`, error);
  }

  override render() {
    return this.state.error ? this.props.fallback(this.state.error, () => this.setState({ error: null })) : this.props.children;
  }
}
