#!/usr/bin/env bb
;; Last Man Standing live: hoe ver is iedere loper?
;; Gebruik: bb lms.clj            (alle lopers in de race)
;;          bb lms.clj --all      (ook uitgevallen lopers)
(require '[babashka.http-client :as http]
         '[cheshire.core :as json])

(def data (-> (http/get "https://event.upfront.nl/api/lms-live")
              :body (json/parse-string true)))

(def points (-> data :course :points))
(def lap-m (-> data :course :distance))

(defn xy [lat lng]
  ;; equirectangular projectie in meters, prima op deze schaal
  [(* lng 111320 (Math/cos (Math/toRadians 53.37))) (* lat 110540)])

(def segs
  (mapv (fn [[a b]] {:a (xy (:lat a) (:lng a)) :b (xy (:lat b) (:lng b))
                     :d0 (:dist a) :d1 (:dist b)})
        (partition 2 1 points)))

(defn project
  "Afstand langs het parcours (m) + afwijking van het parcours (m)."
  [lat lng]
  (let [[px py] (xy lat lng)]
    (->> segs
         (map (fn [{[ax ay] :a [bx by] :b :keys [d0 d1]}]
                (let [dx (- bx ax) dy (- by ay)
                      l2 (+ (* dx dx) (* dy dy))
                      t (if (zero? l2) 0 (max 0 (min 1 (/ (+ (* (- px ax) dx) (* (- py ay) dy)) l2))))
                      cx (+ ax (* t dx)) cy (+ ay (* t dy))]
                  {:along (+ d0 (* t (- d1 d0)))
                   :off (Math/hypot (- px cx) (- py cy))})))
         (apply min-key :off))))

(def status-name {0 "niet gestart" 1 "in race" 3 "niet gestart" 4 "uit"})
(def cur-lap (:currentLap data))
(def event-start (.toEpochMilli (java.time.Instant/parse (:eventStart data))))
(def lap-start (.toEpochMilli (java.time.Instant/parse (:currentLapStartedAt data))))
(def elapsed (/ (- (System/currentTimeMillis) lap-start) 1000.0))

(defn ms [s] (.toEpochMilli (.toInstant (java.time.OffsetDateTime/parse s))))

(defn lap-of
  "Bij welke ronde hoort een finish? Het uur waarin hij valt, behalve in de
  eerste 30 min: dan is het een te late finish van de ronde ervoor. Zo tellen
  rondes mee waarvan de tijdwaarneming de doorkomst gemist heeft."
  [finished-at]
  (let [e (- (ms finished-at) event-start)
        h (inc (quot e 3600000))]
    (if (< (mod e 3600000) 1800000) (dec h) h)))

(defn laps
  "Wie nog in de race is, heeft ook de gemiste rondes gelopen: de laatste finish
  bepaalt het aantal. Uitgevallen lopers: de API volgen."
  [r]
  (if (and (= 1 (:status r)) (seq (:lapTimes r)))
    (max (:laps r) (lap-of (:finishedAt (last (:lapTimes r)))))
    (:laps r)))

(defn row [r]
  (let [n (laps r)
        in? (= 1 (:status r))
        done? (>= n cur-lap)
        out? (or (not in?) (< n (dec cur-lap)))
        {:keys [along off]} (when (and (:lat r) (not done?) (not out?))
                              (project (:lat r) (:lng r)))
        ;; Start en finish liggen op hetzelfde punt. Bij start/finish = niet
        ;; vertrokken als de tracker sinds de start van de ronde niets stuurde, of
        ;; als de loper op eigen tempo nog lang niet binnen kan zijn (en < 30 min:
        ;; de snelste ronde duurt ruim 32 min).
        valid (->> (:lapTimes r) (map :seconds) (filter #(<= % 3600)))
        avg (if (seq valid) (/ (reduce + valid) (count valid)) 3000)
        stale? (some-> (:lastPingAt r) ms (< lap-start))
        too-early? (or (< elapsed 1800) (< elapsed (- avg 300)))
        camp? (and off
                   (or (< along 150) (> along (- lap-m 150)))
                   (or (< along 150) stale? too-early?)
                   (> elapsed (if (> off 50) 300 600)))
        in-lap (cond done? lap-m camp? 0 along along :else 0)
        total-km (/ (+ (* (min n (dec cur-lap)) lap-m) (if out? 0 in-lap)) 1000)]
    {:bib (:bib r) :name (:name r) :laps n
     :gemist (when (not= n (:laps r)) (- n (:laps r)))
     :ronde (cond (not in?) (if (= 4 (:status r)) (str "uit in " (:outInLap r)) (status-name (:status r)))
                  out? (str "uit na ronde " n)
                  done? "binnen, wacht"
                  camp? (if (> elapsed 300) "niet vertrokken" "bij de start")
                  :else (format "%4.0f%% (%.2f km)" (* 100 (/ in-lap lap-m)) (/ in-lap 1000)))
     ;; in de eerste minuten staat iedereen bij de start: dat telt als in de race
     :state (cond out? 3 done? 0 (and camp? (> elapsed 300)) 2 :else 1)
     :progress (if (and along (not camp?)) along 0)
     :off (when off (Math/round off))
     :kmh (:speedKmh r)
     :totaal (format "%.1f" (double total-km))
     :ping (some-> (:lastPingAt r) (subs 11 19))}))

(let [all? (some #{"--all"} *command-line-args*)
      rows (->> (:runners data)
                (map row)
                (filter #(or all? (< (:state %) 3)))
                (sort-by (juxt :state #(- (:laps %)) #(- (:progress %)))))
      in-race (count (filter #(< (:state %) 2) (map row (:runners data))))]
  (println (format "Ronde %d (gestart %s UTC) | echt in race %d | API zegt %d/%d | data van %s"
                   cur-lap (subs (:currentLapStartedAt data) 11 16) in-race
                   (:inRace data) (:starters data) (subs (:generatedAt data) 11 19)))
  (println (format "%-4s %-4s %-28s %-7s %-22s %6s %5s %8s %s" "#" "bib" "naam" "laps" "huidige ronde" "km/u" "off-m" "tot. km" "ping"))
  (doseq [[i {:keys [bib name laps gemist ronde kmh off totaal ping]}] (map-indexed vector rows)]
    (println (format "%-4s %-4s %-28s %-7s %-22s %6s %5s %8s %s"
                     (inc i) bib (subs name 0 (min 28 (count name)))
                     (str laps (when gemist (str " +" gemist)))
                     ronde (or kmh "") (or off "") totaal (or ping ""))))
  (when (some :gemist rows)
    (println "\n+N = rondes die de tijdwaarneming miste maar wel gelopen zijn")))
