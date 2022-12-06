import React from "react";

import "../../assets/css/main.css";

import logo2 from "../../assets/images/logo2.png";
import profile from "../../assets/images/profile-header.jpg";

const header = () => {
  return (
    <>
      <header class="header-area header-cont ">
        <div class="container">
          <div class="row">
            <div class="col-12">
              <nav class="main-nav">
                <a href="index.html" class="logo">
                  <img class=".logo" src={logo2} alt="" />
                </a>

                <ul class="nav">
                  <li>
                    <a href="index.html" class="active">
                      Home
                    </a>
                  </li>
                  <li>
                    <a href="browse.html">Browse</a>
                  </li>
                  <li>
                    <a href="details.html">Details</a>
                  </li>
                  <li>
                    <a href="streams.html">Streams</a>
                  </li>
                  <li></li>
                </ul>

                <div class="search-input">
                  <form id="search" action="#">
                    <input
                      type="text"
                      placeholder="Search nearby Store"
                      id="searchText"
                      name="searchKeyword"
                      onkeypress="handle"
                    />
                    <i class="fa fa-search"></i>
                  </form>
                </div>
              </nav>
            </div>
          </div>
        </div>
      </header>
    </>
  );
};

export default header;
