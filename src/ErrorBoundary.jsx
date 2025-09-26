import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state={error:null}; }
  static getDerivedStateFromError(error){ return { error }; }
  componentDidCatch(error, info){ console.error("Caught by ErrorBoundary:", error, info); }
  render(){
    if(this.state.error){
      return (
        <div style={{padding:20,fontFamily:"sans-serif"}}>
          <h2>Greška u renderu</h2>
          <pre style={{whiteSpace:"pre-wrap"}}>{String(this.state.error?.message || this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
