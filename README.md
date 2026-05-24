# El Culo - Baraja espanola (multijugador en red local)

Juego de cartas "El Culo" (El Presidente) para jugar entre varias personas
conectadas a la misma red WiFi. Un equipo hace de servidor y el resto se
une abriendo un enlace en el navegador.

## Requisitos

- Node.js (ya instalado)
- pnpm (ya instalado)

## Como arrancar el servidor

Dentro de la carpeta `BarajaCulo`:

```
pnpm install
pnpm start
```

La consola mostrara dos enlaces:

```
En este equipo:   http://localhost:3000
Para tus amigos:  http://192.168.x.x:3000
```

## Como se unen los jugadores

1. Quien arranca el servidor abre `http://localhost:3000`.
2. Los demas, en la **misma red WiFi**, abren el enlace **"Para tus amigos"**
   (`http://192.168.x.x:3000`) en su movil o portatil.
3. Cada uno escribe su nombre y entra a la mesa. Se puede cambiar luego desde
   el lobby con el boton **"Cambiar nombre"**.
4. El primero en entrar es el **anfitrion** y es quien pulsa "Empezar partida".

> **Cortafuegos de Windows:** la primera vez que arranques el servidor,
> Windows puede preguntar si permites el acceso de Node.js a la red.
> Hay que pulsar **"Permitir acceso"** en redes privadas; si no, tus amigos
> no podran conectarse.

Para cerrar el servidor: `Ctrl + C` en la consola.

## Reglas implementadas

- Baraja espanola de **40 cartas** (oros, copas, espadas, bastos; 1-7, 10, 11, 12).
- De **3 a 8 jugadores**. Se reparten todas las cartas.
- En tu turno juegas 1 carta o un grupo de cartas iguales (pareja, trio...).
- El siguiente debe jugar **el mismo numero de cartas** con un valor **igual o mayor**, o pasar.
- Los **2 son comodines**: valen como cualquier numero al formar parejas, trios, etc.
- Jugar **un 1 o un 2 corta la baza**: se limpia la mesa y vuelve a jugar quien la corto.
- Si juegas un valor **igual** al de la mesa, el siguiente jugador **pierde ese turno**
  (vuelve a jugar cuando le toque de nuevo).
- Orden de valor: 1 < 2 < ... < 7 < 10 < 11 < 12.
- Si todos pasan, se limpia la mesa y el ultimo que jugo lidera la nueva baza.
- El primero en quedarse sin cartas es **Presidente**; el ultimo, el **Culo**.
- A partir de la 2ª ronda hay intercambio: el Culo entrega sus **1 y 2** (sus
  mejores cartas) al Presidente, y este elige 2 cartas cualesquiera para
  devolverle. Si el Culo no tiene suficientes 1/2, elige el las que entrega.
  El Vice-culo entrega un 1 o un 2 al Vicepresidente y este le devuelve 1
  (solo con 4 jugadores o mas).

## Decisiones de diseno (no estaban en las reglas originales)

- **1ª ronda:** empieza un jugador elegido al azar.
- **Rondas siguientes:** empieza el Culo de la ronda anterior.
- Al pasar pierdes solo ese turno; puedes volver a jugar si la baza sigue abierta.
- Si un jugador se desconecta, el juego pasa o juega su carta mas baja por el
  para que la partida no se quede bloqueada; puede reconectarse con el mismo enlace.

## Archivos

- `server.js` - servidor HTTP + Socket.IO.
- `game.js` - logica del juego (baraja, reparto, turnos, intercambio).
- `public/` - interfaz web (HTML, CSS, JavaScript).
