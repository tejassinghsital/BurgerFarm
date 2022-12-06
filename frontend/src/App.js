import "./App.css";
import Header from "./components/header/Header.js";
import Snow from "./components/Snow.js";
import Card from "./components/Card.js";
import Hero from "./components/Hero";
import Menu from "./components/Menu";
import Farmmenu from "./components/farmmenu/farmmenu";
const App = () => {
  return (
    <>
      <Header />
      <Snow />
      <Hero />
      <Farmmenu />
      <Menu />
      {/* <Farm /> */}

      {/* <Card /> */}
    </>
  );
};

export default App;
