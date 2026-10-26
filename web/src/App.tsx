import { useEffect } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Header } from "./components/Header";
import { useLocation } from "./hooks";
import { href, matchRoute } from "./lib/router";
import { ArtistPage } from "./pages/ArtistPage";
import { LoginPage, RegisterPage } from "./pages/AuthPages";
import { HelpArticlePage, HelpPage } from "./pages/HelpPages";
import { HomePage } from "./pages/HomePage";
import { ListingPage } from "./pages/ListingPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { OrdersPage } from "./pages/OrdersPage";
import { MyRequestsPage, RequestNewPage, RequestPage, RequestsBoardPage } from "./pages/RequestsPages";
import { SearchPage } from "./pages/SearchPage";
import { StaffPage } from "./pages/StaffPage";
import { SupportPage, TicketPage } from "./pages/SupportPages";
import { WalletPage } from "./pages/WalletPage";

function Page({ path, query }: { path: string; query: URLSearchParams }) {
  const match = matchRoute(path);
  switch (match?.name) {
    case "home":
      return <HomePage />;
    case "search":
      return <SearchPage query={query} />;
    case "listing":
      return <ListingPage id={match.params.id ?? ""} />;
    case "login":
      return <LoginPage query={query} />;
    case "register":
      return <RegisterPage />;
    case "wallet":
      return <WalletPage />;
    case "orders":
      return <OrdersPage />;
    case "notifications":
      return <NotificationsPage />;
    case "help":
      return <HelpPage query={query} />;
    case "help-article":
      return <HelpArticlePage slug={match.params.slug ?? ""} />;
    case "artist":
      return <ArtistPage />;
    case "requests":
      return <RequestsBoardPage query={query} />;
    case "request-new":
      return <RequestNewPage />;
    case "requests-mine":
      return <MyRequestsPage />;
    case "request":
      return <RequestPage id={match.params.id ?? ""} />;
    case "support":
      return <SupportPage />;
    case "ticket":
      return <TicketPage id={match.params.id ?? ""} />;
    case "staff":
      return <StaffPage />;
    default:
      return (
        <section>
          <h1>Page not found</h1>
          <p>
            <a href={href("/")}>Back to the home page</a>
          </p>
        </section>
      );
  }
}

export function App() {
  const location = useLocation();
  useEffect(() => {
    // Keep the braces: some browsers return a Promise from scrollTo, and React would call a returned value as a cleanup function.
    window.scrollTo(0, 0);
  }, [location.path]);
  return (
    <>
      <a
        className="skip"
        href={href("/")}
        onClick={(event) => {
          // A plain #main link would be read by the hash router as a page, so move focus instead.
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <Header path={location.path} query={location.query} />
      <main id="main" tabIndex={-1}>
        <ErrorBoundary key={`${location.path}?${location.query.toString()}`}>
          <div className="page-enter">
            <Page path={location.path} query={location.query} />
          </div>
        </ErrorBoundary>
      </main>
      <footer className="site-footer">
        <p className="muted">ArtShelf runs offline with simulated payments. <a href={href("/help")}>Help center</a></p>
      </footer>
    </>
  );
}
