import { AlertBanner } from '@/components/ui';
import type { MissingField } from '@/lib/missingData';
import type { NextAction } from '@/lib/nextAction';

const BANNER_TYPE: Record<NextAction['code'], 'info' | 'warning' | 'danger' | 'success'> = {
  MISSING_DATA: 'warning',
  OPEN_TASKS: 'info',
  PLAN_NOT_ACCEPTED: 'warning',
  REACTIVATE: 'warning',
  NO_UPCOMING_VISIT: 'info',
  UP_TO_DATE: 'success',
};

export default function NextActionBanner({
  nextAction,
  missingFields,
}: {
  nextAction: NextAction | null;
  missingFields: MissingField[];
}) {
  if (!nextAction || nextAction.code === 'UP_TO_DATE') return null;
  return (
    <AlertBanner type={BANNER_TYPE[nextAction.code]}>
      <strong>Próxima ação:</strong> {nextAction.label}
      {missingFields.length > 0 && nextAction.code !== 'MISSING_DATA' && (
        <div style={{ marginTop: 4, fontSize: 'var(--text-xs)', opacity: 0.85 }}>
          Também em falta: {missingFields.map((f) => f.label).join(', ')}
        </div>
      )}
    </AlertBanner>
  );
}
