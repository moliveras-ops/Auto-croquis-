# Auto croquis

Sube una imagen y obtén un croquis con su geometría detectada. Dos modos: **Orificios y patrón** (por ejemplo, un espejo de tubos) y **Contornos** (líneas, círculos, arcos y rectángulos). Todo corre en el navegador; la imagen no sale de tu equipo.

## Uso

1. Abre `index.html` (o la página de GitHub Pages) y pulsa **Subir imagen**. También puedes arrastrar o pegar una imagen.
2. Elige un **perfil** (Inspección, Plano técnico, Silueta, Detallado) y ajusta sensibilidad, suavizado, simplificación y largo mínimo.
3. **Calibra la escala**: pulsa *Calibrar con 2 puntos*, haz clic en dos puntos de distancia conocida e ingresa la medida real. Las medidas pasan de píxeles a mm, cm o m.
4. Haz clic en una fila de la tabla para resaltar el elemento, o en × para quitarlo del croquis.
5. **Exporta** a SVG, DXF (líneas, círculos y arcos en la capa `CROQUIS`), PNG o JSON.

## Modo Orificios y patrón

Detecta cada orificio como una mancha circular a varias escalas (diferencia de gaussianas), ajusta su radio por el gradiente radial, descarta los de tamaño atípico y los que no siguen el patrón. Estima el paso, el tipo de malla (triangular o cuadrada) y su giro, y numera cada orificio por fila y columna. Exporta a CSV, JSON, DXF y SVG.

Si no detecta bien: ajusta el rango de Ø (en píxeles de la imagen de trabajo), la sensibilidad, o marca *Orificios claros* si se ven más claros que el fondo.

## Cómo funciona el modo Contornos

Escala de grises, suavizado gaussiano y bordes con Canny. Luego traza los bordes a polilíneas, une extremos cercanos, las simplifica (Douglas-Peucker) y clasifica cada una: círculo o arco por ajuste de mínimos cuadrados, rectángulo por ángulos rectos y el resto como líneas o polígonos. El código del análisis está en `core.js` y la interfaz en `app.js`.

## Límites

- Las esquinas redondeadas de una pieza salen como segmentos cortos, no como arcos.
- Fotos con perspectiva o sombras fuertes necesitan ajustar la sensibilidad. La escala supone una vista frontal sin distorsión.

## Publicar en GitHub Pages

*Settings → Pages → Deploy from a branch → `main` / `(root)`.*
