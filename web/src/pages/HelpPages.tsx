import { useState, type FormEvent } from "react";
import { api } from "../api";
import { ErrorNotice, Loading } from "../components/Notice";
import { useAsync } from "../hooks";
import { href } from "../lib/router";
import type { HelpArticle, HelpArticleSummary } from "../lib/types";

export function HelpPage({ query }: { query: URLSearchParams }) {
  const q = query.get("q") ?? "";
  const [text, setText] = useState(q);
  const articles = useAsync(() => api.get<{ articles: HelpArticleSummary[] }>("/support/help", { q }), [q]);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    window.location.hash = href("/help", { q: text.trim() }).slice(1);
  };

  return (
    <>
      <h1>Help center</h1>
      <form className="searchbox" role="search" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="help-search">
          Search help
        </label>
        <input id="help-search" type="search" value={text} maxLength={100} placeholder="Search help articles" onChange={(event) => setText(event.target.value)} />
        <button type="submit">Search</button>
      </form>
      {articles.loading ? <Loading /> : <ErrorNotice error={articles.error} />}
      {articles.data && articles.data.articles.length === 0 ? <p className="muted">No articles match “{q}”.</p> : null}
      <ul className="articles">
        {articles.data?.articles.map((article) => (
          <li key={article.slug}>
            <a href={href(`/help/${article.slug}`)}>{article.title}</a>
            <p className="muted">{article.summary}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Paragraphs are separated by blank lines; lines starting with "- " become list items. Everything is rendered as text. */
function ArticleBody({ body }: { body: string }) {
  return (
    <>
      {body.split("\n\n").map((block, index) => {
        const lines = block.split("\n");
        const bullets = lines.filter((line) => line.startsWith("- "));
        if (bullets.length > 0 && bullets.length === lines.length) {
          return (
            <ul key={index}>
              {bullets.map((line, i) => (
                <li key={i}>{line.slice(2)}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{block}</p>;
      })}
    </>
  );
}

export function HelpArticlePage({ slug }: { slug: string }) {
  const article = useAsync(() => api.get<{ article: HelpArticle }>(`/support/help/${encodeURIComponent(slug)}`), [slug]);
  if (article.loading) return <Loading />;
  if (article.error || !article.data) return <ErrorNotice error={article.error ?? new Error("Article not found")} />;
  return (
    <article className="prose">
      <p>
        <a href={href("/help")}>← Help center</a>
      </p>
      <h1>{article.data.article.title}</h1>
      <ArticleBody body={article.data.article.body} />
    </article>
  );
}
