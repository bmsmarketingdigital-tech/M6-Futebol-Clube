export function onlyDigits(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

export function isValidCpfCnpj(value: string) {
  const digits = onlyDigits(value);
  if (![11, 14].includes(digits.length) || /^(\d)\1+$/.test(digits)) return false;
  const baseLength = digits.length === 11 ? 9 : 12;
  const calculate = (length: number) => {
    let factor = length - 7;
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * factor--;
      if (factor < 2) factor = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return (
    calculate(baseLength) === Number(digits[baseLength]) &&
    calculate(baseLength + 1) === Number(digits[baseLength + 1])
  );
}
