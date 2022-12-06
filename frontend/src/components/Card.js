import React from "react";
import "../assets/css/card.css";

const Card = () => {
  return (
    <>
      <div class="content">
        <ul class="team">
          <li class="member co-funder">
            <div class="thumb">
              <img src="https://assets.codepen.io/3/internal/avatars/users/default.png?fit=crop&format=auto&height=120&width=120" />
            </div>
            <div class="description">
              <h3>Chris Coyier</h3>
              <p>
                Chris is a front-end developer and designer. He writes a bunch
                of HTML, CSS, and JavaScript and shakes the pom-poms for
                CodePen.
                <a href="https://codepen.io/chriscoyier/">@chriscoyier</a>
              </p>
            </div>
          </li>

          <li class="member">
            <div class="thumb">
              <img src="https://cpwebassets.codepen.io/assets/packs/about-deevazquez-c8e8b7f9e803f462b7be19ea60b9272f.jpg?height=120&width=120" />
            </div>
            <div class="description">
              <h3>Dee Vazquez</h3>
              <p>
                Dee is a full stack developer who started her career in finance.
                She can jump from Rails to React to Go, and also manage our
                finances.
                <br />
                <a href="https://codepen.io/deequez/">@deequez</a>
              </p>
            </div>
          </li>
        </ul>
      </div>
    </>
  );
};

export default Card;
