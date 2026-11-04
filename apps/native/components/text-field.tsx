import { Text, TextInput, View, type TextInputProps } from "react-native";

import { radius, space, usePalette } from "@/lib/theme";

type TextFieldProps = TextInputProps & {
  label: string;
  error?: string | null;
  /** Viser "n / max tegn" under feltet. */
  counterMax?: number;
};

export function TextField({ label, error, counterMax, style, multiline, ...props }: TextFieldProps) {
  const p = usePalette();
  const length = props.value?.length ?? 0;
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{label}</Text>
      <TextInput
        placeholderTextColor={p.textMuted}
        accessibilityLabel={label}
        multiline={multiline}
        maxLength={counterMax}
        {...props}
        style={[
          {
            color: p.text,
            backgroundColor: p.surface,
            borderColor: error ? p.danger : p.borderStrong,
            borderWidth: 1,
            borderRadius: radius.md,
            borderCurve: "continuous",
            paddingHorizontal: space.md,
            paddingVertical: space.md,
            fontSize: 16,
            minHeight: multiline ? 96 : 48,
            textAlignVertical: multiline ? "top" : "center",
          },
          style,
        ]}
      />
      {error || counterMax ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
          <Text selectable style={{ color: p.danger, fontSize: 13, flex: 1 }}>
            {error ?? ""}
          </Text>
          {counterMax ? (
            <Text style={{ color: p.textMuted, fontSize: 13, fontVariant: ["tabular-nums"] }}>
              {length} / {counterMax} tegn
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
