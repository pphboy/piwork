/** Page data receipts are independent of shell rendering and transient requests. */
export interface PageReadScope {
  readonly path: string;
  readonly view: number;
  readonly identity: number;
}
type PageReadSnapshot =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable'; readonly error: unknown }
  | { readonly status: 'confirmed'; readonly confirmedAt: string };

export class PageReadState {
  private scope: PageReadScope | null = null;
  private state: PageReadSnapshot = { status: 'loading' };

  private matches(scope: PageReadScope): boolean {
    return this.scope?.path === scope.path && this.scope.view === scope.view
      && this.scope.identity === scope.identity;
  }

  begin(scope: PageReadScope): void {
    if (this.matches(scope)) return;
    this.scope = { ...scope };
    this.state = { status: 'loading' };
  }

  confirm(scope: PageReadScope, confirmedAt: string): void {
    if (this.matches(scope)) this.state = { status: 'confirmed', confirmedAt };
  }

  fail(scope: PageReadScope, error: unknown): void {
    if (this.matches(scope) && this.state.status !== 'confirmed') {
      this.state = { status: 'unavailable', error };
    }
  }

  snapshot(scope: PageReadScope): PageReadSnapshot | null {
    return this.matches(scope) ? this.state : null;
  }
}
