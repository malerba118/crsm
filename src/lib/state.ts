export type Unsubscriber = () => void;
export type Subscriber = (transaction?: Transaction) => void;

export interface Observable<State> {
  get: <Selection = State>(
    selector?: (val: State) => Selection,
    transaction?: Transaction
  ) => Selection;
  subscribe: (subscriber: Subscriber) => Unsubscriber;
}

export type ExtractObservableType<Type> = Type extends Observable<infer X>
  ? X
  : never;

export type ExtractObservableTypes<Map extends AtomMoleculeMap> = {
  [K in keyof Map]: ExtractObservableType<Map[K]>;
};

type AtomMoleculeMap = Record<string, Atom<any, any> | Molecule<any, any, any>>;

export type Setter<State> = (value: State) => State;

export type Set<State> = (
  setter: State | Setter<State>,
  transaction?: Transaction
) => void;

export interface Writable<State> {
  set: Set<State>;
}

export interface Transaction {
  commit: () => void;
  rollback: () => void;
  onCommit: (subscriber: Subscriber) => Unsubscriber;
  onRollback: (subscriber: Subscriber) => Unsubscriber;
}

export interface Atom<State, Actions extends {}>
  extends Observable<State>,
    Writable<State> {
  actions: Actions;
}

export interface Molecule<
  Children extends AtomMoleculeMap,
  Actions extends {},
  ComputedState
> extends Observable<ComputedState> {
  children: Children;
  actions: Actions;
}

export interface AtomOptions<State, Actions extends {}> {
  actions: (set: Writable<State>['set']) => Actions;
}

const createSubscriptionManager = <SubscriberArgs extends any[] = []>() => {
  type Subscriber = (...args: SubscriberArgs) => void;
  let subscribers: Subscriber[] = [];
  return {
    subscribe: (subscriber: Subscriber) => {
      subscribers.push(subscriber);
      return () => {
        subscribers = subscribers.filter((s) => s !== subscriber);
      };
    },
    notifySubscribers: (...args: SubscriberArgs) => {
      subscribers.forEach((subscriber) => {
        subscriber(...args);
      });
    },
  };
};

export const transaction = (): Transaction => {
  const managers = {
    commit: createSubscriptionManager(),
    rollback: createSubscriptionManager(),
  };
  const commit = () => {
    managers.commit.notifySubscribers();
  };
  const rollback = () => {
    managers.rollback.notifySubscribers();
  };
  const onCommit = (subscriber: () => void) => {
    return managers.commit.subscribe(subscriber);
  };
  const onRollback = (subscriber: () => void) => {
    return managers.rollback.subscribe(subscriber);
  };
  return {
    commit,
    rollback,
    onCommit,
    onRollback,
  };
};

let currentTransaction: Transaction | undefined;

export const atom = <State, Actions extends {}>(
  defaultValue: State,
  options?: AtomOptions<State, Actions>
): Atom<State, Actions> => {
  let value: State = defaultValue;
  const transactionValues = new WeakMap<Transaction, State>();
  const manager = createSubscriptionManager<[Transaction | undefined]>();
  const set = (
    setter: Setter<State> | State,
    transaction: Transaction | undefined = currentTransaction
  ) => {
    if (transaction) {
      if (!transactionValues.has(transaction)) {
        transaction.onCommit(() => {
          value = transactionValues.get(transaction) as State;
          transactionValues.delete(transaction);
        });
        transaction.onRollback(() => {
          transactionValues.delete(transaction);
        });
        transactionValues.set(transaction, value);
      }
      let nextValue: State;
      if (typeof setter === 'function') {
        nextValue = (setter as Setter<State>)(
          transactionValues.get(transaction) as State
        );
      } else {
        nextValue = setter;
      }
      transactionValues.set(transaction, nextValue);
    } else {
      if (typeof setter === 'function') {
        value = (setter as Setter<State>)(value);
      } else {
        value = setter;
      }
    }
    manager.notifySubscribers(transaction);
  };
  return {
    set,
    get: (selector = (x) => x as any, transaction) => {
      if (transaction && transactionValues.has(transaction)) {
        return selector(transactionValues.get(transaction) as State);
      }
      return selector(value);
    },
    subscribe: (subscriber: (transaction?: Transaction) => void) => {
      return manager.subscribe(subscriber);
    },
    actions:
      !!options && !!options.actions ? options.actions(set) : ({} as Actions),
  };
};

export type EffectCleanup = () => void;
export type Effect<State> = (value: State) => EffectCleanup | void;

export const observe = <State>(
  observable: Observable<State>,
  effect: Effect<State>
) => {
  const transactions = new Set<Transaction>();
  const tryRunEffect = () => {
    try {
      effect(observable.get());
    } catch (err) {
      console.warn('effect threw an error:', err);
    }
  };
  tryRunEffect();
  return observable.subscribe((transaction) => {
    if (transaction) {
      if (!transactions.has(transaction)) {
        transactions.add(transaction);
        transaction.onCommit(() => {
          tryRunEffect();
          transactions.delete(transaction);
        });
        transaction.onRollback(() => {
          transactions.delete(transaction);
        });
      }
    } else {
      tryRunEffect();
    }
  });
};

export type Computer<Deps extends AtomMoleculeMap, ComputedState> = (
  args: {
    [Index in keyof Deps]: ExtractObservableType<Deps[Index]>;
  }
) => ComputedState;

export const computed = <Deps extends AtomMoleculeMap, ComputedState>(
  dependencies: Deps,
  computer: Computer<Deps, ComputedState>
): Observable<ComputedState> => {
  const getArgs = (transaction?: Transaction): any => {
    let args: any = {};
    Object.keys(dependencies).forEach((key) => {
      const observable: any = dependencies[key];
      args[key] = observable.get((x: any) => x, transaction);
    });
    return args;
  };
  let value: ComputedState = computer(getArgs());
  const manager = createSubscriptionManager<[Transaction | undefined]>();
  const transactionValues = new WeakMap<Transaction, ComputedState>();
  const unsubscribers: Unsubscriber[] = [];
  Object.values(dependencies).forEach((observable: any) => {
    const unsubscribe = observable.subscribe((transaction: Transaction) => {
      if (transaction) {
        if (!transactionValues.has(transaction)) {
          transaction.onCommit(() => {
            value = transactionValues.get(transaction) as ComputedState;
            transactionValues.delete(transaction);
          });
          transaction.onRollback(() => {
            transactionValues.delete(transaction);
          });
          transactionValues.set(transaction, value);
        }
        let nextValue: ComputedState = computer(getArgs(transaction));
        transactionValues.set(transaction, nextValue);
      }
      value = computer(getArgs(transaction));
      manager.notifySubscribers(transaction);
    });
    unsubscribers.push(unsubscribe);
  });

  // const unsubscribe = () => {
  //   unsubscribers.forEach((unsubscribe) => unsubscribe());
  // };

  return {
    get: (selector = (x) => x as any, transaction) => {
      if (transaction && transactionValues.has(transaction)) {
        return selector(transactionValues.get(transaction) as ComputedState);
      }
      return selector(value);
    },
    subscribe: (subscriber: (transaction?: Transaction) => void) => {
      return manager.subscribe(subscriber);
    },
  };
};

export interface MoleculeOptions<
  Children extends AtomMoleculeMap,
  Actions extends {},
  ComputedState
> {
  actions?: (children: Children) => Actions;
  computer?: Computer<Children, ComputedState>;
}

export const molecule = <
  Children extends AtomMoleculeMap,
  Actions extends {},
  ComputedState = ExtractObservableTypes<Children>
>(
  children: Children,
  {
    actions,
    computer = (x) => x as ComputedState,
  }: MoleculeOptions<Children, Actions, ComputedState> = {}
): Molecule<Children, Actions, ComputedState> => {
  const observable = computed(children, computer);

  return {
    ...observable,
    children,
    actions: actions?.(children) ?? ({} as Actions),
  };
};

export const batched = <ExecutorParams extends any[], ExecutorReturn>(
  executor: (...args: ExecutorParams) => ExecutorReturn
) => {
  return (...args: ExecutorParams): ExecutorReturn => {
    // nested batch calls should be ignored in favor of the outermost
    if (!currentTransaction) {
      currentTransaction = transaction();
    }
    try {
      let returnVal = executor(...args);
      currentTransaction.commit();
      currentTransaction = undefined;
      return returnVal;
    } catch (err) {
      if (currentTransaction) {
        currentTransaction.rollback();
      }
      currentTransaction = undefined;
      throw err;
    }
  };
};
