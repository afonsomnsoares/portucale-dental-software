import { computeStagnantInventory } from '@/lib/inventory';
import { withRoute } from '@/lib/route';

// Produtos parados: o contrário da rutura, e o mais fácil de ignorar. Quatro estados
// distintos (nunca consumido, parado, rotação lenta, parado e a expirar) porque
// tratá-los como um só é o que torna a lista inútil — ver lib/inventoryCalc.ts.
export const GET = withRoute({ permission: 'inventory:manage' }, async ({ tenantId }) => {
  const items = await computeStagnantInventory(tenantId);
  const withValue = items.filter((i) => i.tiedUpValue !== null);
  return Response.json({
    items,
    totals: {
      count: items.length,
      // Só soma o que tem preço. Um total que trate os itens sem custo como 0 € seria
      // menor do que a realidade e ninguém saberia porquê.
      tiedUpValue: Math.round(withValue.reduce((s, i) => s + (i.tiedUpValue || 0), 0) * 100) / 100,
      itemsWithoutCost: items.length - withValue.length,
    },
  });
});
