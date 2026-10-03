#!/usr/bin/env bb
;; Last Man Standing live: hoe ver is iedere loper?
;; Gebruik: bb lms.bb            (alle lopers in de race)
;;          bb lms.bb --all      (ook uitgevallen lopers)
(require '[babashka.http-client :as http]
         '[cheshire.core :as json]
         '[clojure.string :as str])

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

(def status-name {0 "?" 1 "in race" 3 "uit" 4 "DNS/DNF"})
(def cur-lap (:currentLap data))

(defn row [r]
  (let [done? (>= (:laps r) cur-lap)
        {:keys [along off]} (when (and (:lat r) (not done?) (= 1 (:status r)))
                              (project (:lat r) (:lng r)))
        in-lap (cond done? lap-m along along :else 0)
        total-km (/ (+ (* (min (:laps r) (dec cur-lap)) lap-m)
                       (if (= 1 (:status r)) in-lap 0)) 1000)]
    {:pos (:pos r) :bib (:bib r) :name (:name r)
     :status (status-name (:status r) (:status r))
     :laps (:laps r)
     :ronde (cond (not= 1 (:status r)) (str "uit in " (:outInLap r))
                  done? "binnen, wacht"
                  (< (:laps r) (dec cur-lap)) (str "UIT na ronde " (:laps r))
                  (and (< along 100) (> off 50)) "bij start/kamp, niet gestart?"
                  :else (format "%4.0f%% (%.2f km)" (* 100 (/ in-lap lap-m)) (/ in-lap 1000)))
     :off (when off (Math/round off))
     :kmh (:speedKmh r)
     :totaal (format "%.1f" (double total-km))
     :ping (some-> (:lastPingAt r) (subs 11 19))}))

(let [all? (some #{"--all"} *command-line-args*)
      rows (->> (:runners data)
                (filter #(or all? (= 1 (:status %))))
                (filter #(or all? (>= (:laps %) (dec cur-lap))))
                (map row))]
  (println (format "Ronde %d (gestart %s UTC) | in race %d/%d | data van %s"
                   cur-lap (subs (:currentLapStartedAt data) 11 16)
                   (:inRace data) (:starters data) (subs (:generatedAt data) 11 19)))
  (println (format "%-4s %-4s %-28s %-5s %-22s %6s %5s %8s %s" "pos" "bib" "naam" "laps" "huidige ronde" "km/u" "off-m" "tot. km" "ping"))
  (doseq [{:keys [pos bib name laps ronde kmh off totaal ping]} rows]
    (println (format "%-4s %-4s %-28s %-5s %-22s %6s %5s %8s %s"
                     pos bib (subs name 0 (min 28 (count name))) laps ronde kmh (or off "") totaal ping))))
