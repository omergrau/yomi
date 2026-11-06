import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { parseIso, toIso } from './domain/dates';

export const hasNativePickers = true;

export const pickDate = (current: string | null, min: string) =>
  new Promise<string | null>((resolve) => {
    DateTimePickerAndroid.open({
      mode: 'date',
      value: parseIso(current ?? min),
      minimumDate: parseIso(min),
      onChange: (e, d) => resolve(e.type === 'set' && d ? toIso(d) : null),
    });
  });

export const pickTime = (current: string | null) =>
  new Promise<string | null>((resolve) => {
    const base = new Date();
    if (current) {
      const [h, m] = current.split(':').map(Number);
      base.setHours(h, m, 0, 0);
    }
    DateTimePickerAndroid.open({
      mode: 'time',
      is24Hour: true,
      value: base,
      onChange: (e, d) => resolve(e.type === 'set' && d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : null),
    });
  });
