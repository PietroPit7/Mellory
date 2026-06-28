import { useCallback, useRef } from "react";
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  /** Scala raggiunta mentre l'elemento è premuto (default 0.97). */
  pressedScale?: number;
};

/**
 * Pressable con micro-interazione: si rimpicciolisce dolcemente alla pressione
 * e torna in posizione al rilascio. Drop-in replacement di Pressable, mantiene
 * lo stesso layout (lo stile resta sul Pressable, non aggiunge wrapper).
 */
export function PressableScale({
  pressedScale = 0.97,
  onPressIn,
  onPressOut,
  style,
  accessibilityRole = "button",
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = useCallback((toValue: number, bounciness: number) => {
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 50,
      bounciness,
    }).start();
  }, [scale]);

  return (
    <AnimatedPressable
      onPressIn={(event: GestureResponderEvent) => {
        animateTo(pressedScale, 0);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        animateTo(1, 6);
        onPressOut?.(event);
      }}
      style={[style, { transform: [{ scale }] }]}
      {...rest}
    />
  );
}
