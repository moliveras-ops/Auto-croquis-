# Auto croquis

Sube una foto y obtén un croquis con su geometría. Todo corre en el navegador; la imagen no sale del equipo.

App: https://moliveras-ops.github.io/auto-croquis-/

## Modo Orificios y patrón (espejos de tubos, placas perforadas)

1. **Subir imagen**: el Ø de los orificios se estima automáticamente.
2. **Dibujar zona**: encierra el espejo (elipse o rectángulo) para ignorar textos, bordes y fondo.
3. Revisa el resultado: azul = orificio detectado, verde = agregado a mano, **X roja = posible faltante** (posición del patrón sin orificio: tubo taponado, oculto o no detectado).
4. Corrige con las herramientas: **+ Orificio** (si tocas una X roja se ajusta a ella), **Quitar**, **Deshacer**.
5. **Escala**: escribe el Ø real del tubo, el paso real o una distancia entre 2 puntos, y pulsa *Aplicar*.
6. **Exportar**: CSV para Excel (n, fila, columna, x, y, Ø, estado), PNG, DXF (capas ORIFICIOS y FALTANTES), SVG o JSON.

Zoom con pellizco, rueda del mouse, doble clic o los botones − ⤢ +. Arrastra para desplazarte.

Cómo detecta: manchas circulares a varias escalas (diferencia de gaussianas), radio por gradiente radial, filtro por tamaño dominante y por vecinos a un paso de distancia. Estima paso, malla (triangular o cuadrada) y giro, numera por fila y columna, y busca posiciones del patrón rodeadas de orificios pero vacías.

## Modo Contornos

Bordes con Canny, trazado a polilíneas, simplificación y clasificación en líneas, rectángulos, polígonos, círculos y arcos. Perfiles: Inspección, Plano técnico, Silueta, Detallado.

## Límites

- La escala supone foto frontal; con perspectiva fuerte el paso varía a lo ancho de la imagen.
- Óxido o manchas del tamaño de un orificio pueden confundirse; revisa y corrige con las herramientas.
- Las posiciones faltantes en el borde exterior del patrón no se marcan, para evitar falsos positivos.

Código: análisis en `core.js`, interfaz en `app.js`.
