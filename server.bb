#!/usr/bin/env bb
;; Lokale ontwikkelserver voor de Last Man Standing live-pagina.
;; Serveert index.html en geeft de API van Upfront door met CORS-headers,
;; net als de Cloudflare Worker online doet.
;; Start: bb server.bb   -> http://localhost:8787
(require '[babashka.http-client :as http]
         '[org.httpkit.server :as server]
         '[clojure.java.io :as io])

(def api "https://event.upfront.nl/api/lms-live")
(def port (or (some-> (System/getenv "PORT") parse-long) 8787))
(def here (-> *file* io/file .getParentFile))

(def cors {"Access-Control-Allow-Origin" "*"
           "Access-Control-Allow-Methods" "GET, OPTIONS"
           "Access-Control-Allow-Headers" "*"
           "Access-Control-Allow-Private-Network" "true"})

;; korte cache zodat meerdere tabbladen de API niet extra belasten
(def cache (atom {:at 0 :body nil}))

(defn upstream []
  (let [now (System/currentTimeMillis)
        {:keys [at body]} @cache]
    (if (and body (< (- now at) 10000))
      body
      (let [b (:body (http/get api {:timeout 10000}))]
        (reset! cache {:at now :body b})
        b))))

(defn routes [{:keys [uri request-method]}]
  (cond
    (= request-method :options) {:status 204}

    (= uri "/api/lms-live")
    (try {:status 200
          :headers {"Content-Type" "application/json" "Cache-Control" "no-store"}
          :body (upstream)}
         (catch Exception e
           {:status 502 :headers {"Content-Type" "application/json"}
            :body (str "{\"error\":" (pr-str (str (ex-message e))) "}")}))

    (#{"/" "/index.html"} uri)
    {:status 200
     :headers {"Content-Type" "text/html; charset=utf-8"}
     :body (slurp (io/file here "index.html"))}

    :else {:status 404 :body "niet gevonden"}))

(defn handler [req]
  (update (routes req) :headers merge cors))

(server/run-server handler {:port port})
(println (str "Last Man Standing live: http://localhost:" port))
@(promise)
