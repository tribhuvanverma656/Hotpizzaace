import {
  parseSharedAddressBook,
  type SharedAddressBook,
  type SharedAddressMutation,
} from './commerce/addresses';
import { CommerceError } from './commerce/client';

type AddressTransport = {
  read: (signal: AbortSignal) => Promise<unknown>;
  mutate: (input: SharedAddressMutation, signal: AbortSignal) => Promise<unknown>;
};
export type CustomerAddressesSnapshot = {
  userId: string | null;
  book: SharedAddressBook | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  errorCode: string | null;
};

export function addressBookError(error: unknown): CommerceError {
  const status = error instanceof CommerceError ? error.status : 503;
  const code = error instanceof CommerceError ? error.code : undefined;
  const messages: Record<string, string> = {
    address_duplicate: 'This delivery address is already saved. Edit the existing address instead.',
    address_revision_conflict:
      'Your address book changed on another device. Review the latest addresses before saving again.',
    address_conflict:
      'This address may already be saved. Review the latest address book before trying again.',
    address_not_found:
      'This address was removed on another device. Your unsaved draft is still here.',
    address_limit_reached: 'You have 10 saved addresses. Remove one before adding another.',
    address_limit: 'You have 10 saved addresses. Remove one before adding another.',
    address_identity_changed: 'Your signed-in account changed. Review addresses for this account.',
    address_busy: 'An address change is already being saved. Please wait.',
  };
  const message =
    code && Object.hasOwn(messages, code)
      ? messages[code]
      : status === 401 || status === 403
        ? 'Sign in with Google again to open your saved addresses.'
        : 'We couldn’t sync your saved addresses. Please try again.';
  return new CommerceError(message, status, code);
}

/** Account-scoped memory only. Delayed reads and writes cannot restore a previous account. */
export class CustomerAddressesState {
  private snapshot: CustomerAddressesSnapshot = {
    userId: null,
    book: null,
    loading: false,
    saving: false,
    error: null,
    errorCode: null,
  };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private readVersion = 0;
  private readController: AbortController | null = null;
  private mutationController: AbortController | null = null;

  constructor(private readonly transport: AddressTransport) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(next: CustomerAddressesSnapshot) {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  setIdentity(userId: string | null) {
    if (userId === this.snapshot.userId) return;
    ++this.epoch;
    ++this.readVersion;
    this.readController?.abort();
    this.mutationController?.abort();
    this.readController = null;
    this.mutationController = null;
    this.publish({
      userId,
      book: null,
      loading: !!userId,
      saving: false,
      error: null,
      errorCode: null,
    });
  }

  private isCurrent(userId: string, epoch: number) {
    return this.snapshot.userId === userId && this.epoch === epoch;
  }

  private applyBook(book: SharedAddressBook) {
    if (this.snapshot.book && book.revision < this.snapshot.book.revision) return;
    this.publish({ ...this.snapshot, book, loading: false, error: null, errorCode: null });
  }

  refreshIfIdle(): Promise<void> {
    return this.readController ? Promise.resolve() : this.refresh();
  }

  async refresh(): Promise<void> {
    const userId = this.snapshot.userId;
    if (!userId) return;
    const epoch = this.epoch;
    const version = ++this.readVersion;
    this.readController?.abort();
    const controller = new AbortController();
    this.readController = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    this.publish({
      ...this.snapshot,
      loading: !this.snapshot.book,
      error: null,
      errorCode: null,
    });
    try {
      const response = await this.transport.read(controller.signal);
      if (!this.isCurrent(userId, epoch) || version !== this.readVersion) return;
      const book = parseSharedAddressBook(response);
      this.applyBook(book);
    } catch (cause) {
      if (!this.isCurrent(userId, epoch) || version !== this.readVersion) return;
      const error = addressBookError(cause);
      this.publish({
        ...this.snapshot,
        book: error.status === 401 || error.status === 403 ? null : this.snapshot.book,
        loading: false,
        error: error.message,
        errorCode: error.code ?? null,
      });
    } finally {
      clearTimeout(timeout);
      if (this.readController === controller) this.readController = null;
    }
  }

  async mutate(input: SharedAddressMutation): Promise<SharedAddressBook> {
    const userId = this.snapshot.userId;
    if (!userId || !this.snapshot.book)
      throw addressBookError(new CommerceError('Unavailable address book.', 401));
    if (this.snapshot.saving)
      throw addressBookError(new CommerceError('Mutation in progress.', 409, 'address_busy'));
    const epoch = this.epoch;
    if (input.expectedRevision !== this.snapshot.book.revision) {
      await this.refresh();
      if (!this.isCurrent(userId, epoch))
        throw addressBookError(
          new CommerceError('Account changed.', 409, 'address_identity_changed'),
        );
      throw addressBookError(
        new CommerceError('Stale address book.', 409, 'address_revision_conflict'),
      );
    }
    ++this.readVersion;
    this.readController?.abort();
    const controller = new AbortController();
    this.mutationController = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    this.publish({ ...this.snapshot, saving: true, error: null, errorCode: null });
    try {
      const response = await this.transport.mutate(input, controller.signal);
      if (!this.isCurrent(userId, epoch))
        throw new CommerceError('Account changed.', 409, 'address_identity_changed');
      const book = parseSharedAddressBook(response);
      this.applyBook(book);
      return this.snapshot.book!;
    } catch (cause) {
      if (!this.isCurrent(userId, epoch))
        throw addressBookError(
          new CommerceError('Account changed.', 409, 'address_identity_changed'),
        );
      const error = addressBookError(cause);
      // Reload for review; never replay a write after conflict, duplicate or response loss.
      if (error.status === 409 || error.status === 404) await this.refresh();
      if (!this.isCurrent(userId, epoch))
        throw addressBookError(
          new CommerceError('Account changed.', 409, 'address_identity_changed'),
        );
      this.publish({
        ...this.snapshot,
        book: error.status === 401 || error.status === 403 ? null : this.snapshot.book,
        error: this.snapshot.error ?? error.message,
        errorCode: this.snapshot.errorCode ?? error.code ?? null,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.mutationController === controller) this.mutationController = null;
      if (this.isCurrent(userId, epoch)) this.publish({ ...this.snapshot, saving: false });
    }
  }

  dispose() {
    this.setIdentity(null);
  }
}
