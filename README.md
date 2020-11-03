# crsm

Composable reactive state management

```tsx
import { atom, batched, molecule, observe } from "crsm";

const createCounter = (defaultVal: number) => {
  return atom(defaultVal, {
    actions: (set) => ({
      increment: () => set((prev) => prev + 1),
      decrement: () => set((prev) => prev - 1)
    })
  });
};

const sum$ = molecule(
  {
    counterOne: createCounter(0),
    counterTwo: createCounter(0)
  },
  {
    actions: ({ counterOne, counterTwo }) => ({
      increment: batched(() => {
        counterOne.actions.increment();
        counterTwo.actions.increment();
      }),
      decrement: batched(() => {
        counterOne.actions.decrement();
        counterTwo.actions.decrement();
      })
    }),
    computer: ({ counterOne, counterTwo }) => {
      return counterOne + counterTwo;
    }
  }
);

observe(sum$, (sum) => {
  console.log(sum);
});

sum$.actions.increment();
sum$.actions.decrement();
```