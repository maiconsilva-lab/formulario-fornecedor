/* next/dynamic: carrega o componente na primeira renderização. */
import React from 'react';
export default function dynamic(loader) {
  let Comp = null; let promessa = null;
  return function Dinamico(props) {
    const [, forcar] = React.useReducer((x) => x + 1, 0);
    React.useEffect(() => {
      if (Comp) return;
      promessa = promessa || Promise.resolve(loader()).then((m) => { Comp = m && m.default ? m.default : m; });
      promessa.then(forcar);
    }, []);
    return Comp ? React.createElement(Comp, props) : null;
  };
}
